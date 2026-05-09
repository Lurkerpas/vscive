import * as vscode from 'vscode';
import { InterfaceViewEditorProvider } from './editor/InterfaceViewEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            InterfaceViewEditorProvider.viewType,
            new InterfaceViewEditorProvider(context.extensionUri),
            { supportsMultipleEditorsPerDocument: false },
        )
    );
}

export function deactivate(): void {
    // Nothing to clean up
}
