import * as vscode from 'vscode';
import { DEFAULT_OPTIONS, EditorOptions } from '../model/types';

type SavedEditorOptions = Partial<EditorOptions> & { useDockerWrapperForCommands?: boolean };

export function isWindowsHost(): boolean {
    return typeof process !== 'undefined' && process.platform === 'win32';
}

export function getDefaultEditorOptions(): EditorOptions {
    return {
        ...DEFAULT_OPTIONS,
        useTasteCliBatForCommands: isWindowsHost(),
    };
}

export function resolveEditorOptions(saved: SavedEditorOptions | undefined): EditorOptions {
    const defaults = getDefaultEditorOptions();
    const configuration = vscode.workspace.getConfiguration('vscive');
    const configuredUseTasteCliShForCommands = configuration.get<boolean>(
        'useTasteCliShForCommands',
        configuration.get<boolean>('useDockerWrapperForCommands', defaults.useTasteCliShForCommands),
    );
    const configuredUseTasteCliBatForCommands = configuration.get<boolean>(
        'useTasteCliBatForCommands',
        defaults.useTasteCliBatForCommands,
    );
    const useTasteCliShForCommands = saved?.useTasteCliShForCommands
        ?? saved?.useDockerWrapperForCommands
        ?? configuredUseTasteCliShForCommands;
    const useTasteCliBatForCommands = saved?.useTasteCliBatForCommands
        ?? configuredUseTasteCliBatForCommands;

    return {
        ...defaults,
        ...saved,
        useTasteCliShForCommands,
        useTasteCliBatForCommands,
    };
}

export function shouldUseTasteCliWrapper(options: Pick<EditorOptions, 'useTasteCliShForCommands' | 'useTasteCliBatForCommands'>): boolean {
    return options.useTasteCliShForCommands || options.useTasteCliBatForCommands;
}