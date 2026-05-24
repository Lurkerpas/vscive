import * as vscode from 'vscode';
import { isWindowsHost } from './editorOptions';

const SHARED_TERMINAL_NAME = 'VSCive Commands';

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cmdQuote(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

function getSharedTerminal(): vscode.Terminal {
    const existing = vscode.window.terminals.find((terminal) => terminal.name === SHARED_TERMINAL_NAME);
    if (existing) {
        return existing;
    }

    if (isWindowsHost()) {
        return vscode.window.createTerminal({
            name: SHARED_TERMINAL_NAME,
            shellPath: process.env.ComSpec ?? 'cmd.exe',
        });
    }

    return vscode.window.createTerminal({ name: SHARED_TERMINAL_NAME });
}

function wrapCommandForDirectory(command: string, cwd: vscode.Uri): string {
    if (isWindowsHost()) {
        const quotedDir = cmdQuote(cwd.fsPath);
        return `set "__vscive_prev_dir=%CD%" && cd /d ${quotedDir} && ${command} & set "__vscive_status=%ERRORLEVEL%" & cd /d "%__vscive_prev_dir%" & if not "%__vscive_status%"=="0" echo [vscive] Command exited with status %__vscive_status% & set "__vscive_prev_dir=" & set "__vscive_status="`;
    }

    const quotedDir = shellQuote(cwd.fsPath);
    return `__vscive_prev_dir=$PWD; cd ${quotedDir} && ${command}; __vscive_status=$?; cd "$__vscive_prev_dir"; unset __vscive_prev_dir; if [ "$__vscive_status" -ne 0 ]; then echo "[vscive] Command exited with status $__vscive_status"; fi; unset __vscive_status`;
}

export function runInSharedTerminal(command: string, cwd: vscode.Uri): void {
    const terminal = getSharedTerminal();
    terminal.show();
    terminal.sendText(wrapCommandForDirectory(command, cwd));
}