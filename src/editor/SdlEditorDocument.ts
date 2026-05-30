import * as vscode from 'vscode';
import type { SdlInsertKind, SdlModel, SdlSymbol } from '../model/types';
import { parsePr, findSymbolById } from '../parsers/SdlPrParser';
import { applySymbolMove, applySymbolTextEdit, applySymbolInsert, applySymbolsDelete } from '../serializers/SdlPrSerializer';
import { decodeUtf8, encodeUtf8 } from '../utils/platform';

export class SdlEditorDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    sdl!: SdlModel;

    private constructor(uri: vscode.Uri) {
        this.uri = uri;
    }

    dispose(): void {
        // No external resources held.
    }

    static async create(uri: vscode.Uri): Promise<SdlEditorDocument> {
        const doc = new SdlEditorDocument(uri);
        await doc.reload();
        return doc;
    }

    async reload(): Promise<void> {
        const bytes = await vscode.workspace.fs.readFile(this.uri);
        this.sdl = parsePr(decodeUtf8(bytes));
    }

    /** Deep-clone the current model for undo/redo. */
    snapshot(): SdlModel {
        return JSON.parse(JSON.stringify(this.sdl)) as SdlModel;
    }

    /** Restore from a snapshot produced by `snapshot()`. */
    restore(snap: SdlModel): void {
        this.sdl = JSON.parse(JSON.stringify(snap)) as SdlModel;
    }

    /** Move (and/or resize) a symbol: updates CIF coordinates in-place. */
    moveSymbol(id: string, x: number, y: number, w: number, h: number): void {
        const sym = findSymbolById(this.sdl.tree, id);
        if (sym) applySymbolMove(this.sdl, sym, x, y, w, h);
    }

    /** Edit the text of a symbol: updates the text span in-place. */
    editSymbolText(id: string, text: string): void {
        const sym = findSymbolById(this.sdl.tree, id);
        if (sym) applySymbolTextEdit(this.sdl, sym, text);
    }

    /** Delete one or more symbols and refresh the parsed SDL tree. */
    deleteSymbols(ids: string[]): void {
        applySymbolsDelete(this.sdl, ids);
    }

    /** Create a new symbol either on canvas or following an anchor symbol. */
    createSymbol(
        kind: SdlInsertKind,
        mode: 'canvas' | 'following',
        x: number,
        y: number,
        anchorId?: string,
        containerId?: string,
        containerKind?: 'tree' | 'children' | 'nestedChildren',
    ): void {
        applySymbolInsert(this.sdl, { kind, mode, x, y, anchorId, containerId, containerKind });
    }

    /** Write the current model back to disk. */
    async save(cancellation?: vscode.CancellationToken): Promise<void> {
        if (cancellation?.isCancellationRequested) return;
        const content = this.sdl.lines.join('\n');
        await vscode.workspace.fs.writeFile(this.uri, encodeUtf8(content));
    }

    /** Write to a different location (Save As). */
    async saveAs(destination: vscode.Uri, cancellation?: vscode.CancellationToken): Promise<void> {
        if (cancellation?.isCancellationRequested) return;
        const content = this.sdl.lines.join('\n');
        await vscode.workspace.fs.writeFile(destination, encodeUtf8(content));
    }

    /** Find a symbol by id in the current tree. */
    findSymbol(id: string): SdlSymbol | null {
        return findSymbolById(this.sdl.tree, id);
    }
}
