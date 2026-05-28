import * as vscode from 'vscode';
import { DEFAULT_OPTIONS, EditorOptions } from '../model/types';

type SavedEditorOptions = Partial<EditorOptions> & { useDockerWrapperForCommands?: boolean };

/** Bump this when SDL symbol colors change to reset saved settings once. */
const SDL_COLORS_VERSION = 1;

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

    // Migrate SDL symbol colors if the saved version is below current.
    const savedSdlColorsVersion = saved?.sdlColorsVersion ?? 0;
    const sdlColorReset: Partial<EditorOptions> = savedSdlColorsVersion < SDL_COLORS_VERSION
        ? { sdlDecisionColor: defaults.sdlDecisionColor, sdlStartColor: defaults.sdlStartColor }
        : {};

    return {
        ...defaults,
        ...saved,
        ...sdlColorReset,
        sdlColorsVersion: SDL_COLORS_VERSION,
        useTasteCliShForCommands,
        useTasteCliBatForCommands,
    };
}

export function shouldUseTasteCliWrapper(options: Pick<EditorOptions, 'useTasteCliShForCommands' | 'useTasteCliBatForCommands'>): boolean {
    return options.useTasteCliShForCommands || options.useTasteCliBatForCommands;
}