import * as vscode from 'vscode';
import { InterfaceViewEditorProvider } from './editor/InterfaceViewEditorProvider';
import { log, showLog } from './logger';

export function activate(context: vscode.ExtensionContext): void {
    showLog();
    log(`activate — extensionUri: ${context.extensionUri.fsPath}`);
    try {
        context.subscriptions.push(
            vscode.window.registerCustomEditorProvider(
                InterfaceViewEditorProvider.viewType,
                new InterfaceViewEditorProvider(context),
                { supportsMultipleEditorsPerDocument: false },
            )
        );
        log('registerCustomEditorProvider OK');
    } catch (err) {
        log(`registerCustomEditorProvider FAILED: ${err}`);
        vscode.window.showErrorMessage(`vscive activate failed: ${err}`);
        throw err;
    }
}

export function deactivate(): void {
    log('deactivate');
}
