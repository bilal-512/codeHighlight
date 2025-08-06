import * as vscode from 'vscode';

let overlayDecoration: vscode.TextEditorDecorationType | undefined;
let topBorderDecoration: vscode.TextEditorDecorationType | undefined;
let bottomBorderDecoration: vscode.TextEditorDecorationType | undefined;
let borderDecoration: vscode.TextEditorDecorationType | undefined;
let singleLineBorderDecoration: vscode.TextEditorDecorationType | undefined;
let dimDecoration: vscode.TextEditorDecorationType | undefined;
let disposableSelection: vscode.Disposable | undefined;
let disposableMouseDown: vscode.Disposable | undefined;
let disposableMouseMove: vscode.Disposable | undefined;
let disposableMouseUp: vscode.Disposable | undefined;
let isActivated = false;
let isSelecting = false;
let selectionStart: vscode.Position | undefined;
let selectionEnd: vscode.Position | undefined;
let currentFocusRange: vscode.Range | undefined;
let selectionTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Focus Highlight Tool extension is now active!');

    // Command to toggle focus mode
    const toggleCommand = vscode.commands.registerCommand('focusHighlight.toggle', () => {
        console.log('Toggle command executed');
        if (isActivated) {
            deactivateFocusMode();
        } else {
            activateFocusMode();
        }
    });

    // Command to explicitly activate focus mode
    const activateCommand = vscode.commands.registerCommand('focusHighlight.activate', () => {
        console.log('Activate command executed');
        activateFocusMode();
    });

    // Command to explicitly deactivate focus mode
    const deactivateCommand = vscode.commands.registerCommand('focusHighlight.deactivate', () => {
        console.log('Deactivate command executed');
        deactivateFocusMode();
    });

    // Command to clear current selection
    const clearCommand = vscode.commands.registerCommand('focusHighlight.clear', () => {
        if (!isActivated) {
            vscode.window.showWarningMessage('Focus mode is not active');
            return;
        }
        clearFocusArea();
    });

    // Command to start manual selection
    const startSelectionCommand = vscode.commands.registerCommand('focusHighlight.startSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isActivated) {
            vscode.window.showWarningMessage('Focus mode is not active or no editor found');
            return;
        }

        const result = await vscode.window.showInputBox({
            prompt: 'Enter line range (e.g., "5-15" or "10-25")',
            placeHolder: 'startLine-endLine',
            validateInput: (value: string) => {
                if (!value.trim()) {
                    return 'Please enter a line range';
                }
                const match = value.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
                if (!match) {
                    return 'Invalid format. Use "startLine-endLine" (e.g., "5-15")';
                }
                const start = parseInt(match[1]);
                const end = parseInt(match[2]);
                if (start < 1 || end < 1) {
                    return 'Line numbers must be greater than 0';
                }
                if (start > end) {
                    return 'Start line must be less than or equal to end line';
                }
                if (end > editor.document.lineCount) {
                    return `End line cannot exceed document length (${editor.document.lineCount})`;
                }
                return null;
            }
        });

        if (result) {
            const match = result.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
            if (match) {
                const startLine = Math.max(0, parseInt(match[1]) - 1); // Convert to 0-based
                const endLine = Math.min(editor.document.lineCount - 1, parseInt(match[2]) - 1);

                const startPos = new vscode.Position(startLine, 0);
                const endPos = new vscode.Position(endLine, editor.document.lineAt(endLine).text.length);

                createFocusArea(editor, startPos, endPos);
            }
        }
    });

    // Listen for active editor changes
    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (isActivated && currentFocusRange && editor) {
            // Validate that the focus range is still valid for the new editor
            if (currentFocusRange.end.line < editor.document.lineCount) {
                updateDecorations(editor, currentFocusRange);
            } else {
                // Clear focus if range is invalid for new document
                clearFocusArea(false);
            }
        }
    });

    // Listen for document changes to update decorations
    const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (isActivated && currentFocusRange && editor && event.document === editor.document) {
            // Check if focus range is still valid after document changes
            if (currentFocusRange.end.line >= editor.document.lineCount) {
                clearFocusArea(false);
            } else {
                updateDecorations(editor, currentFocusRange);
            }
        }
    });

    console.log('All commands registered successfully');
    context.subscriptions.push(
        toggleCommand,
        activateCommand,
        deactivateCommand,
        clearCommand,
        startSelectionCommand,
        editorChangeDisposable,
        documentChangeDisposable
    );
}

function activateFocusMode() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor found');
        return;
    }

    // If already activated, just show message
    if (isActivated) {
        vscode.window.showInformationMessage('Focus mode is already active');
        return;
    }

    isActivated = true;
    vscode.window.showInformationMessage('Focus mode activated - Select text to create focus area, or use Ctrl+Shift+P and search for "Focus Highlight: Start Selection"');

    // Create decoration types with proper error handling
    try {
        // Background decoration for focus area
        overlayDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(64, 128, 255, 0.08)',
            overviewRulerColor: 'rgba(64, 128, 255, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });

        // Top border decoration
        topBorderDecoration = vscode.window.createTextEditorDecorationType({
            border: '2px solid rgba(64, 128, 255, 0.9)',
            borderWidth: '2px 2px 0 2px', // Top and sides
            borderRadius: '8px 8px 0 0'
        });

        // Bottom border decoration  
        bottomBorderDecoration = vscode.window.createTextEditorDecorationType({
            border: '2px solid rgba(64, 128, 255, 0.9)',
            borderWidth: '0 2px 2px 2px', // Bottom and sides
            borderRadius: '0 0 8px 8px'
        });

        // Side borders decoration for middle lines
        borderDecoration = vscode.window.createTextEditorDecorationType({
            border: '2px solid rgba(64, 128, 255, 0.9)',
            borderWidth: '0 2px 0 2px' // Only left and right borders
        });

        // Single line border decoration (all borders with rounded corners)
        singleLineBorderDecoration = vscode.window.createTextEditorDecorationType({
            border: '2px solid rgba(64, 128, 255, 0.9)',
            borderRadius: '8px'
        });

        // Dim decoration for unfocused areas
        dimDecoration = vscode.window.createTextEditorDecorationType({
            opacity: '0.25',
            fontWeight: '300'
        });

        // Set up selection handlers
        setupSelectionHandlers();
    } catch (error) {
        console.error('Error creating decorations:', error);
        vscode.window.showErrorMessage('Failed to activate focus mode');
        deactivateFocusMode();
    }
}

function setupSelectionHandlers() {
    // Clean up existing handler
    if (disposableSelection) {
        disposableSelection.dispose();
    }

    // Listen for text selection changes
    disposableSelection = vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!isActivated || !event.textEditor || event.textEditor !== vscode.window.activeTextEditor) {
            return;
        }

        const selection = event.selections[0];

        // If there's a non-empty selection, create focus area
        if (selection && !selection.isEmpty) {
            // Clear existing timeout
            if (selectionTimeout) {
                clearTimeout(selectionTimeout);
            }

            // Use a small delay to ensure the selection is finalized
            selectionTimeout = setTimeout(() => {
                const editor = vscode.window.activeTextEditor;
                const currentSelection = editor?.selection;
                if (editor && currentSelection && !currentSelection.isEmpty) {
                    createFocusArea(editor, currentSelection.start, currentSelection.end);
                }
                selectionTimeout = undefined;
            }, 100);
        }
    });
}

async function createFocusArea(editor: vscode.TextEditor, start: vscode.Position, end: vscode.Position) {
    if (!editor || !editor.document) {
        console.warn('Invalid editor or document');
        return;
    }

    try {
        // Clear any existing focus area first
        clearFocusArea(false); // false = don't show message

        // Ensure start is before end
        const actualStart = start.isBeforeOrEqual(end) ? start : end;
        const actualEnd = start.isBeforeOrEqual(end) ? end : start;

        // Validate line numbers
        const maxLine = editor.document.lineCount - 1;
        const validStart = new vscode.Position(
            Math.max(0, Math.min(actualStart.line, maxLine)),
            0
        );
        const validEnd = new vscode.Position(
            Math.max(0, Math.min(actualEnd.line, maxLine)),
            editor.document.lineAt(Math.min(actualEnd.line, maxLine)).text.length
        );

        currentFocusRange = new vscode.Range(validStart, validEnd);

        updateDecorations(editor, currentFocusRange);

        vscode.window.showInformationMessage(`Focus area updated: lines ${validStart.line + 1}-${validEnd.line + 1}`);
    } catch (error) {
        console.error('Error creating focus area:', error);
        vscode.window.showErrorMessage('Failed to create focus area');
    }
}

function updateDecorations(editor: vscode.TextEditor, focusRange: vscode.Range) {
    if (!overlayDecoration || !dimDecoration || !editor.document) {
        console.warn('Missing decorations or editor document');
        return;
    }

    try {
        const document = editor.document;
        const dimRanges: vscode.Range[] = [];
        const focusRanges: vscode.Range[] = [];
        const topBorderRanges: vscode.Range[] = [];
        const bottomBorderRanges: vscode.Range[] = [];
        const sideBorderRanges: vscode.Range[] = [];
        const singleLineBorderRanges: vscode.Range[] = [];

        // Validate focus range bounds
        const maxLine = document.lineCount - 1;
        const validFocusRange = new vscode.Range(
            new vscode.Position(Math.max(0, Math.min(focusRange.start.line, maxLine)), 0),
            new vscode.Position(
                Math.max(0, Math.min(focusRange.end.line, maxLine)),
                Math.min(focusRange.end.character, document.lineAt(Math.min(focusRange.end.line, maxLine)).text.length)
            )
        );

        // Calculate the maximum line width in the selection to create uniform rectangle
        let maxLineWidth = 0;
        for (let i = validFocusRange.start.line; i <= validFocusRange.end.line; i++) {
            if (i >= 0 && i < document.lineCount) {
                try {
                    const line = document.lineAt(i);
                    maxLineWidth = Math.max(maxLineWidth, line.text.length);
                } catch (error) {
                    console.warn(`Could not access line ${i}:`, error);
                }
            }
        }

        // Ensure minimum width for empty lines or very short lines
        maxLineWidth = Math.max(maxLineWidth, 1);

        // Check if this is a single line selection
        const isSingleLine = validFocusRange.start.line === validFocusRange.end.line;

        // Apply background to all lines in focus range with uniform width
        for (let i = validFocusRange.start.line; i <= validFocusRange.end.line; i++) {
            if (i >= 0 && i < document.lineCount) {
                try {
                    // Use the maximum width for uniform rectangle
                    focusRanges.push(new vscode.Range(i, 0, i, maxLineWidth));
                } catch (error) {
                    console.warn(`Could not create focus range for line ${i}:`, error);
                }
            }
        }

        if (isSingleLine) {
            // For single line, use special decoration with all borders
            if (validFocusRange.start.line >= 0 && validFocusRange.start.line < document.lineCount) {
                singleLineBorderRanges.push(new vscode.Range(
                    validFocusRange.start.line, 0,
                    validFocusRange.start.line, maxLineWidth
                ));
            }
        } else {
            // Apply top border to the first line with uniform width
            if (validFocusRange.start.line >= 0 && validFocusRange.start.line < document.lineCount) {
                topBorderRanges.push(new vscode.Range(
                    validFocusRange.start.line, 0,
                    validFocusRange.start.line, maxLineWidth
                ));
            }

            // Apply bottom border to the last line with uniform width
            if (validFocusRange.end.line >= 0 && validFocusRange.end.line < document.lineCount) {
                bottomBorderRanges.push(new vscode.Range(
                    validFocusRange.end.line, 0,
                    validFocusRange.end.line, maxLineWidth
                ));
            }

            // Apply side borders to middle lines with uniform width
            for (let i = validFocusRange.start.line + 1; i < validFocusRange.end.line; i++) {
                if (i >= 0 && i < document.lineCount) {
                    sideBorderRanges.push(new vscode.Range(i, 0, i, maxLineWidth));
                }
            }
        }

        // Create dim ranges for all other lines
        for (let i = 0; i < document.lineCount; i++) {
            // Skip lines within the focus range
            if (i >= validFocusRange.start.line && i <= validFocusRange.end.line) {
                continue;
            }

            try {
                const line = document.lineAt(i);
                if (line) {
                    dimRanges.push(line.rangeIncludingLineBreak);
                }
            } catch (error) {
                console.warn(`Could not access line ${i}:`, error);
            }
        }

        // Apply all decorations with error handling
        if (focusRanges.length > 0) {
            editor.setDecorations(overlayDecoration, focusRanges);
        }

        if (isSingleLine && singleLineBorderDecoration && singleLineBorderRanges.length > 0) {
            editor.setDecorations(singleLineBorderDecoration, singleLineBorderRanges);
        } else {
            if (topBorderDecoration && topBorderRanges.length > 0) {
                editor.setDecorations(topBorderDecoration, topBorderRanges);
            }

            if (bottomBorderDecoration && bottomBorderRanges.length > 0) {
                editor.setDecorations(bottomBorderDecoration, bottomBorderRanges);
            }

            if (borderDecoration && sideBorderRanges.length > 0) {
                editor.setDecorations(borderDecoration, sideBorderRanges);
            }
        }

        if (dimRanges.length > 0) {
            editor.setDecorations(dimDecoration, dimRanges);
        }

        // Update the current focus range to the validated one
        currentFocusRange = validFocusRange;

    } catch (error) {
        console.error('Error updating decorations:', error);
        vscode.window.showErrorMessage('Error updating focus area decorations');
    }
}

function clearFocusArea(showMessage: boolean = true) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    currentFocusRange = undefined;

    // Clear timeout if exists
    if (selectionTimeout) {
        clearTimeout(selectionTimeout);
        selectionTimeout = undefined;
    }

    try {
        // Clear all decorations from the current editor
        const decorationsToClean = [
            overlayDecoration,
            topBorderDecoration,
            bottomBorderDecoration,
            dimDecoration,
            borderDecoration,
            singleLineBorderDecoration
        ];

        decorationsToClean.forEach(decoration => {
            if (decoration) {
                try {
                    editor.setDecorations(decoration, []);
                } catch (error) {
                    console.warn('Error clearing decoration:', error);
                }
            }
        });

        if (showMessage) {
            vscode.window.showInformationMessage('Focus area cleared');
        }
    } catch (error) {
        console.error('Error clearing focus area:', error);
        if (showMessage) {
            vscode.window.showErrorMessage('Error clearing focus area');
        }
    }
}

function deactivateFocusMode() {
    if (!isActivated) {
        vscode.window.showInformationMessage('Focus mode is already inactive');
        return;
    }

    isActivated = false;
    isSelecting = false;
    currentFocusRange = undefined;
    selectionStart = undefined;
    selectionEnd = undefined;

    // Clear timeout if exists
    if (selectionTimeout) {
        clearTimeout(selectionTimeout);
        selectionTimeout = undefined;
    }

    try {
        // Clear all decorations from ALL visible editors
        const decorations = [
            overlayDecoration,
            topBorderDecoration,
            bottomBorderDecoration,
            dimDecoration,
            borderDecoration,
            singleLineBorderDecoration
        ];

        decorations.forEach(decoration => {
            if (decoration) {
                vscode.window.visibleTextEditors.forEach(editor => {
                    try {
                        editor.setDecorations(decoration!, []);
                    } catch (error) {
                        console.warn('Error clearing decorations from editor:', error);
                    }
                });

                try {
                    decoration.dispose();
                } catch (error) {
                    console.warn('Error disposing decoration:', error);
                }
            }
        });

        // Reset decoration variables
        overlayDecoration = undefined;
        topBorderDecoration = undefined;
        bottomBorderDecoration = undefined;
        dimDecoration = undefined;
        borderDecoration = undefined;
        singleLineBorderDecoration = undefined;

        // Clean up ALL event listeners
        const disposables = [disposableSelection, disposableMouseDown, disposableMouseMove, disposableMouseUp];
        disposables.forEach(disposable => {
            if (disposable) {
                try {
                    disposable.dispose();
                } catch (error) {
                    console.warn('Error disposing listener:', error);
                }
            }
        });

        // Reset disposable variables
        disposableSelection = undefined;
        disposableMouseDown = undefined;
        disposableMouseMove = undefined;
        disposableMouseUp = undefined;

        vscode.window.showInformationMessage('Focus mode deactivated - All highlighting cleared');
    } catch (error) {
        console.error('Error deactivating focus mode:', error);
        vscode.window.showErrorMessage('Error occurred while deactivating focus mode');
    }
}

export function deactivate() {
    deactivateFocusMode();
}