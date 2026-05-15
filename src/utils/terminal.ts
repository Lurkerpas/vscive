import * as vscode from 'vscode';

const SHARED_TERMINAL_NAME = 'VSCive Commands';

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getSharedTerminal(): vscode.Terminal {
    const existing = vscode.window.terminals.find((terminal) => terminal.name === SHARED_TERMINAL_NAME);
    if (existing) {
        return existing;
    }

    return vscode.window.createTerminal({ name: SHARED_TERMINAL_NAME });
}

function wrapCommandForDirectory(command: string, cwd: vscode.Uri): string {
    const quotedDir = shellQuote(cwd.fsPath);
    return `__vscive_prev_dir=$PWD; cd ${quotedDir} && ${command}; __vscive_status=$?; cd "$__vscive_prev_dir"; unset __vscive_prev_dir; if [ "$__vscive_status" -ne 0 ]; then echo "[vscive] Command exited with status $__vscive_status"; fi; unset __vscive_status`;
}

export function runInSharedTerminal(command: string, cwd: vscode.Uri): void {
    const terminal = getSharedTerminal();
    terminal.show();
    terminal.sendText(wrapCommandForDirectory(command, cwd));
}