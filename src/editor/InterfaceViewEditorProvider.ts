import * as vscode from 'vscode';
import * as path from 'path';
import { InterfaceViewDocument } from './InterfaceViewDocument';
import { DiagramData, DEFAULT_OPTIONS, EditorOptions, ExtensionMessage, IvModel, UiModel, WebviewMessage } from '../model/types';
import { log } from '../logger';

export class InterfaceViewEditorProvider
    implements vscode.CustomEditorProvider<InterfaceViewDocument> {

    static readonly viewType = 'vscive.interfaceViewEditor';

    private readonly _onDidChangeCustomDocument =
        new vscode.EventEmitter<vscode.CustomDocumentEditEvent<InterfaceViewDocument>>();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    /** Map document URI → active webview, used for undo/redo repaint. */
    private readonly _webviews = new Map<string, vscode.Webview>();

    /** Per-document monotonic edit counter for undo depth enforcement. */
    private readonly _editSerials = new Map<string, number>();
    /** Per-document minimum serial still eligible for undo (older entries become no-ops). */
    private readonly _minUndoableSerials = new Map<string, number>();

    constructor(private readonly context: vscode.ExtensionContext) { }

    private get extensionUri() { return this.context.extensionUri; }

    private getOptions(): EditorOptions {
        return this.context.globalState.get<EditorOptions>('editorOptions', DEFAULT_OPTIONS);
    }

    private async saveOptions(options: EditorOptions): Promise<void> {
        await this.context.globalState.update('editorOptions', options);
    }

    async openCustomDocument(uri: vscode.Uri): Promise<InterfaceViewDocument> {
        log(`openCustomDocument: ${uri.fsPath}`);
        try {
            const doc = await InterfaceViewDocument.create(uri);
            log(`openCustomDocument OK: ${doc.iv.functions.length} functions, ${doc.iv.connections.length} connections`);
            return doc;
        } catch (err) {
            log(`openCustomDocument FAILED: ${err}`);
            throw err;
        }
    }

    async resolveCustomEditor(
        document: InterfaceViewDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        log(`resolveCustomEditor: ${document.uri.fsPath}`);
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        const key = document.uri.toString();
        this._webviews.set(key, webviewPanel.webview);
        webviewPanel.onDidDispose(() => this._webviews.delete(key));

        webviewPanel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
            log(`webview message: ${msg.type}`);
            switch (msg.type) {
                case 'ready': {
                    try {
                        const opts = this.getOptions();
                        // Reload schema from the persisted path now that we know it
                        await document.loadSchemaFromPath(opts.attrFilePath);
                        webviewPanel.webview.postMessage({ type: 'options', options: opts } as ExtensionMessage);
                        this.sendDiagram(webviewPanel.webview, document);
                        log('sendDiagram: posted load message');
                    } catch (err) {
                        log(`sendDiagram FAILED: ${err}`);
                    }
                    break;
                }
                case 'nodesMoved': {
                    // Position-only change — no structural reload needed; just persist to model
                    const before = document.snapshot();
                    document.moveNodes(msg.moves);
                    this.fireEdit(document, before);
                    break;
                }
                case 'addFunction': {
                    const before = document.snapshot();
                    document.addFunction(msg.id, msg.name, msg.language, msg.rfX, msg.rfY, msg.parentId);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'addInterface': {
                    const before = document.snapshot();
                    document.addInterface(msg.id, msg.funcId, msg.name, msg.kind, msg.ifaceType, msg.relRfX, msg.relRfY);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'connect': {
                    const before = document.snapshot();
                    document.connect(msg.id, msg.sourceIfaceId, msg.targetIfaceId);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'delete': {
                    const before = document.snapshot();
                    document.deleteEntities(msg.ids);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'updateFunction': {
                    const before = document.snapshot();
                    document.updateFunction(msg.id, { name: msg.name, language: msg.language, defaultImplementation: msg.defaultImplementation, isType: msg.isType, fixedSystemElement: msg.fixedSystemElement, properties: msg.properties, extraAttrs: msg.extraAttrs });
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'updateInterface': {
                    const before = document.snapshot();
                    document.updateInterface(msg.id, { name: msg.name, kind: msg.kind, inheritPI: msg.inheritPI, parameters: msg.parameters, extraAttrs: msg.extraAttrs });
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'buildSkeletons': {
                    const folder = path.dirname(document.uri.fsPath);
                    const terminal = vscode.window.createTerminal({ name: 'Build Skeletons', cwd: folder });
                    terminal.sendText('make skeletons');
                    terminal.show();
                    break;
                }
                case 'build': {
                    const folder = path.dirname(document.uri.fsPath);
                    const terminal = vscode.window.createTerminal({ name: 'Build', cwd: folder });
                    terminal.sendText('make');
                    terminal.show();
                    break;
                }
                case 'editFunction': {
                    // Placeholder — source editing logic to be implemented later
                    vscode.window.showInformationMessage(`Edit Function: ${msg.id} (not yet implemented)`);
                    break;
                }
                case 'connectFunctions': {
                    const before = document.snapshot();
                    document.connectFunctions(msg.riId, msg.piId, msg.riFuncId, msg.piFuncId, msg.riRelX, msg.riRelY, msg.piRelX, msg.piRelY);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'connectToFunction': {
                    const before = document.snapshot();
                    document.connectToFunction(msg.id, msg.connId, msg.existingIfaceId, msg.targetFuncId, msg.relRfX, msg.relRfY);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'updateOptions': {
                    const prev = this.getOptions();
                    await this.saveOptions(msg.options);
                    if (msg.options.attrFilePath !== prev.attrFilePath) {
                        await document.loadSchemaFromPath(msg.options.attrFilePath);
                        this.sendDiagram(webviewPanel.webview, document);
                    }
                    break;
                }
                case 'browseAttrFile': {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: { 'XML files': ['xml'], 'All files': ['*'] },
                        title: 'Select default attributes file',
                    });
                    if (uris && uris.length > 0) {
                        const opts: EditorOptions = { ...this.getOptions(), attrFilePath: uris[0].fsPath };
                        await this.saveOptions(opts);
                        webviewPanel.webview.postMessage({ type: 'options', options: opts } as ExtensionMessage);
                        await document.loadSchemaFromPath(opts.attrFilePath);
                        this.sendDiagram(webviewPanel.webview, document);
                    }
                    break;
                }
                case 'pasteFunction': {
                    const before = document.snapshot();
                    document.pasteFunction(msg.newId, msg.source, msg.rfX, msg.rfY);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'pasteInterface': {
                    const before = document.snapshot();
                    document.pasteInterface(msg.newId, msg.source, msg.funcId, msg.relRfX, msg.relRfY);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'reparentFunction': {
                    const before = document.snapshot();
                    document.reparentFunction(msg.id, msg.newParentId);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'updateConnectionWaypoints': {
                    const before = document.snapshot();
                    document.updateConnectionWaypoints(msg.id, msg.waypoints);
                    this.fireEdit(document, before);
                    // No sendDiagram needed — waypoints are visual-only; local edge state handles display.
                    break;
                }
                case 'exportImage': {
                    const ext = msg.format === 'svg' ? 'svg' : 'png';
                    const defaultUri = vscode.Uri.file(
                        path.join(path.dirname(document.uri.fsPath), `diagram.${ext}`),
                    );
                    const saveUri = await vscode.window.showSaveDialog({
                        defaultUri,
                        filters: msg.format === 'svg'
                            ? { 'SVG image': ['svg'] }
                            : { 'PNG image': ['png'] },
                        title: 'Export Diagram as Image',
                    });
                    if (!saveUri) { break; }
                    // Data URL format: "data:<mime>;base64,<data>"
                    const comma = msg.dataUrl.indexOf(',');
                    const base64 = msg.dataUrl.slice(comma + 1);
                    const bytes = Buffer.from(base64, 'base64');
                    await vscode.workspace.fs.writeFile(saveUri, bytes);
                    vscode.window.showInformationMessage(`Diagram exported to ${path.basename(saveUri.fsPath)}`);
                    break;
                }
            }
        });
    }

    private fireEdit(
        document: InterfaceViewDocument,
        before: { iv: IvModel; ui: UiModel },
    ): void {
        const key = document.uri.toString();
        const serial = (this._editSerials.get(key) ?? 0) + 1;
        this._editSerials.set(key, serial);

        const maxDepth = (this.getOptions().undoDepth ?? 50);
        const minUndoable = Math.max(
            this._minUndoableSerials.get(key) ?? 0,
            serial - maxDepth,
        );
        this._minUndoableSerials.set(key, minUndoable);

        const after = document.snapshot();
        this._onDidChangeCustomDocument.fire({
            document,
            undo: async () => {
                if (serial > (this._minUndoableSerials.get(key) ?? 0)) {
                    document.restore(before);
                    const wv = this._webviews.get(key);
                    if (wv) { this.sendDiagram(wv, document); }
                }
            },
            redo: async () => {
                document.restore(after);
                const wv = this._webviews.get(key);
                if (wv) { this.sendDiagram(wv, document); }
            },
        });
    }

    private sendDiagram(webview: vscode.Webview, document: InterfaceViewDocument): void {
        const data: DiagramData = {
            iv: document.iv,
            ui: document.ui,
            schema: document.schema,
        };
        const msg: ExtensionMessage = { type: 'load', data };
        webview.postMessage(msg);
    }

    // ── CustomEditorProvider save / revert ─────────────────────────────────

    async saveCustomDocument(
        document: InterfaceViewDocument,
        _cancellation: vscode.CancellationToken,
    ): Promise<void> {
        log(`saveCustomDocument: ${document.uri.fsPath}`);
        const { ivXml, uiXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(document.uri, Buffer.from(ivXml, 'utf8'));
        const uiUri = vscode.Uri.file(
            path.join(path.dirname(document.uri.fsPath), document.iv.uiFile),
        );
        await vscode.workspace.fs.writeFile(uiUri, Buffer.from(uiXml, 'utf8'));
        log('saveCustomDocument: done');
    }

    async saveCustomDocumentAs(
        document: InterfaceViewDocument,
        destination: vscode.Uri,
        _cancellation: vscode.CancellationToken,
    ): Promise<void> {
        log(`saveCustomDocumentAs: ${destination.fsPath}`);
        const { ivXml, uiXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(destination, Buffer.from(ivXml, 'utf8'));
        // Write UI file alongside the destination
        const uiUri = vscode.Uri.file(
            path.join(path.dirname(destination.fsPath), document.iv.uiFile),
        );
        await vscode.workspace.fs.writeFile(uiUri, Buffer.from(uiXml, 'utf8'));
        log('saveCustomDocumentAs: done');
    }

    async revertCustomDocument(document: InterfaceViewDocument): Promise<void> {
        log(`revertCustomDocument: ${document.uri.fsPath}`);
        await document.reload();
        const wv = this._webviews.get(document.uri.toString());
        if (wv) { this.sendDiagram(wv, document); }
    }

    async backupCustomDocument(
        document: InterfaceViewDocument,
        context: vscode.CustomDocumentBackupContext,
    ): Promise<vscode.CustomDocumentBackup> {
        const { ivXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(context.destination, Buffer.from(ivXml, 'utf8'));
        return { id: context.destination.toString(), delete: () => undefined };
    }

    // ── HTML ───────────────────────────────────────────────────────────────

    private getHtml(webview: vscode.Webview): string {
        const base = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
        const jsFiles = (() => {
            try {
                const fs = require('fs') as typeof import('fs');
                const assetsDir = path.join(base.fsPath, 'assets');
                const files = fs.readdirSync(assetsDir).filter((f: string) => f.endsWith('.js'));
                log(`getHtml: found JS assets: ${files.join(', ')}`);
                return files.map((f: string) => webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', f)));
            } catch (err) {
                log(`getHtml: failed to read assets dir: ${err}`);
                return [];
            }
        })();
        const cssFiles = (() => {
            try {
                const fs = require('fs') as typeof import('fs');
                const assetsDir = path.join(base.fsPath, 'assets');
                return fs.readdirSync(assetsDir)
                    .filter((f: string) => f.endsWith('.css'))
                    .map((f: string) => webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', f)));
            } catch { return []; }
        })();

        const csp = `default-src 'none'; img-src data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="${csp}"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  ${cssFiles.map((u: vscode.Uri) => `<link rel="stylesheet" href="${u}"/>`).join('\n  ')}
  <style>html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style>
</head>
<body>
  <div id="root"></div>
  ${jsFiles.map((u: vscode.Uri) => `<script type="module" src="${u}"></script>`).join('\n  ')}
</body>
</html>`;
    }
}

