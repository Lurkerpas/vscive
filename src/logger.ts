import * as vscode from 'vscode';

const out = vscode.window.createOutputChannel('vscive');

export function showLog(): void {
    out.show(true);
}

export function log(msg: string): void {
    const line = `[vscive ${new Date().toISOString()}] ${msg}`;
    out.appendLine(line);
    console.log(line);
}
