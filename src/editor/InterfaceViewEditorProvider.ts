import * as vscode from 'vscode';
import { InterfaceViewDocument } from './InterfaceViewDocument';
import {
    DiagramData,
    DEFAULT_OPTIONS,
    EditorOptions,
    ExtensionCapabilities,
    ExtensionMessage,
    FunctionModel,
    IvModel,
    UiModel,
    WebviewMessage,
} from '../model/types';
import { log } from '../logger';
import {
    basename,
    dataUrlToBytes,
    dirnameUri,
    displayUri,
    encodeUtf8,
    extname,
    joinPathSegments,
    serializeUriForSetting,
} from '../utils/platform';
import { runInSharedTerminal } from '../utils/terminal';

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function wrapTasteCliCommand(scriptPath: string, command: string, image: string): string {
    return `TASTE_DOCKER_IMAGE=${shellQuote(image)} bash ${shellQuote(scriptPath)} ${command}`;
}

function getTasteCliShellCommand(extensionUri: vscode.Uri, tasteDockerImage: string): string {
    const scriptPath = joinPathSegments(extensionUri, 'scripts', 'taste-cli.sh').fsPath;
    return wrapTasteCliCommand(scriptPath, '', tasteDockerImage);
}

function getProjectCommand(
    useTasteCliShForCommands: boolean,
    tasteDockerImage: string,
    action: 'make' | 'clean' | 'skeletons' | 'debugBuild' | 'releaseBuild' | 'run' | 'debugRun' | 'releaseRun',
    extensionUri: vscode.Uri,
): string {
    if (useTasteCliShForCommands) {
        const scriptPath = joinPathSegments(extensionUri, 'scripts', 'taste-cli.sh').fsPath;
        switch (action) {
            case 'make':
                return wrapTasteCliCommand(scriptPath, 'make', tasteDockerImage);
            case 'clean':
                return wrapTasteCliCommand(scriptPath, 'make clean', tasteDockerImage);
            case 'skeletons':
                return wrapTasteCliCommand(scriptPath, 'make skeletons', tasteDockerImage);
            case 'debugBuild':
                return wrapTasteCliCommand(scriptPath, 'make debug', tasteDockerImage);
            case 'releaseBuild':
                return wrapTasteCliCommand(scriptPath, 'make release', tasteDockerImage);
            case 'run':
                return wrapTasteCliCommand(scriptPath, 'make run', tasteDockerImage);
            case 'debugRun':
                return wrapTasteCliCommand(scriptPath, 'make debug run', tasteDockerImage);
            case 'releaseRun':
                return wrapTasteCliCommand(scriptPath, 'make release run', tasteDockerImage);
        }
    }

    switch (action) {
        case 'make':
            return 'make';
        case 'clean':
            return 'make clean';
        case 'skeletons':
            return 'make skeletons';
        case 'debugBuild':
            return 'make debug';
        case 'releaseBuild':
            return 'make release';
        case 'run':
            return 'make run';
        case 'debugRun':
            return 'make debug run';
        case 'releaseRun':
            return 'make release run';
    }
}

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

    private getCapabilities(): ExtensionCapabilities {
        const isWebUi = vscode.env.uiKind === vscode.UIKind.Web;
        return {
            canBuild: !isWebUi,
            canBuildSkeletons: !isWebUi,
            canBrowseAttrFile: true,
            canEditFunction: true,
        };
    }

    private getOptions(): EditorOptions {
        const saved = this.context.globalState.get<Partial<EditorOptions> & { useDockerWrapperForCommands?: boolean }>('editorOptions', DEFAULT_OPTIONS);
        const configuredUseTasteCliShForCommands = vscode.workspace
            .getConfiguration('vscive')
            .get<boolean>(
                'useTasteCliShForCommands',
                vscode.workspace
                    .getConfiguration('vscive')
                    .get<boolean>('useDockerWrapperForCommands', DEFAULT_OPTIONS.useTasteCliShForCommands),
            );
        const useTasteCliShForCommands = saved.useTasteCliShForCommands
            ?? saved.useDockerWrapperForCommands
            ?? configuredUseTasteCliShForCommands;
        return { ...DEFAULT_OPTIONS, ...saved, useTasteCliShForCommands };
    }

    private async saveOptions(options: EditorOptions): Promise<void> {
        await this.context.globalState.update('editorOptions', options);
    }

    private findFunctionById(functions: IvModel['functions'], id: string): FunctionModel | undefined {
        for (const fn of functions) {
            if (fn.id === id) { return fn; }
            const nested: FunctionModel | undefined = this.findFunctionById(fn.nestedFunctions, id);
            if (nested) { return nested; }
        }
        return undefined;
    }

    private normalizeFunctionName(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    private resolveSourceLanguage(fn: FunctionModel | undefined): string | undefined {
        if (!fn) { return undefined; }
        if (fn.language) {
            return fn.language;
        }
        if (fn.implementations.length > 0) {
            return fn.implementations[0].language;
        }
        return fn.language;
    }

    private resolveCurrentImplementationName(fn: FunctionModel | undefined): string | undefined {
        if (!fn) { return undefined; }
        const matchingImpl = fn.implementations.find((impl: FunctionModel['implementations'][number]) => impl.language === fn.language);
        if (matchingImpl?.name) { return matchingImpl.name; }
        if (fn.implementations.length === 1) { return fn.implementations[0].name; }
        return undefined;
    }

    private sourceExtensionForLanguage(language: string): string | undefined {
        switch (language.toUpperCase()) {
            case 'C':
                return 'c';
            case 'CPP':
                return 'cc';
            case 'ADA':
                return 'adb';
            default:
                return undefined;
        }
    }

    private async openFunctionSource(document: InterfaceViewDocument, functionId: string): Promise<void> {
        const fn = this.findFunctionById(document.iv.functions, functionId);
        if (!fn) {
            void vscode.window.showErrorMessage(`Function ${functionId} was not found in the current Interface View.`);
            return;
        }

        const sourceLanguage = this.resolveSourceLanguage(fn);
        if (!sourceLanguage) {
            void vscode.window.showErrorMessage(`Function ${fn.name} has no source language configured.`);
            return;
        }

        const extension = this.sourceExtensionForLanguage(sourceLanguage);
        if (!extension) {
            void vscode.window.showErrorMessage(`Edit Function supports only C, CPP, and Ada. ${fn.name} uses ${sourceLanguage}.`);
            return;
        }

        const normalizedName = this.normalizeFunctionName(fn.name);
        const baseFolder = dirnameUri(document.uri);
        const candidateDirs = [
            sourceLanguage,
            this.resolveCurrentImplementationName(fn),
        ].filter((value, index, arr): value is string => !!value && arr.indexOf(value) === index);

        const attemptedPaths: string[] = [];
        for (const dirName of candidateDirs) {
            const fileUri = joinPathSegments(baseFolder, 'work', normalizedName, dirName, 'src', `${normalizedName}.${extension}`);
            attemptedPaths.push(displayUri(fileUri));
            try {
                await vscode.workspace.fs.stat(fileUri);
                const sourceDoc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(sourceDoc, { preview: false, preserveFocus: false });
                return;
            } catch {
                // Try the next candidate path.
            }
        }

        void vscode.window.showErrorMessage(
            `Could not locate source for ${fn.name}. Tried: ${attemptedPaths.join(' ; ')}`,
        );
    }

    async openCustomDocument(uri: vscode.Uri): Promise<InterfaceViewDocument> {
        log(`openCustomDocument: ${uri.toString()}`);
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
        log(`resolveCustomEditor: ${document.uri.toString()}`);
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        const key = document.uri.toString();
        this._webviews.set(key, webviewPanel.webview);
        webviewPanel.onDidDispose(() => this._webviews.delete(key));
        let pendingExport: { uri: vscode.Uri; format: 'png' | 'svg' } | null = null;

        webviewPanel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
            log(`webview message: ${msg.type}`);
            switch (msg.type) {
                case 'ready': {
                    try {
                        const opts = this.getOptions();
                        webviewPanel.webview.postMessage({ type: 'capabilities', capabilities: this.getCapabilities() } as ExtensionMessage);
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
                    document.updateFunction(msg.id, { name: msg.name, language: msg.language, defaultImplementation: msg.defaultImplementation, isType: msg.isType, fixedSystemElement: msg.fixedSystemElement, contextParameters: msg.contextParameters, properties: msg.properties, extraAttrs: msg.extraAttrs });
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
                    if (!this.getCapabilities().canBuildSkeletons) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'skeletons', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'buildClean': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'clean', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'buildDebug': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'debugBuild', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'buildRelease': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'releaseBuild', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'buildCli': {
                    if (!this.getCapabilities().canBuild || !this.getOptions().useTasteCliShForCommands) {
                        break;
                    }
                    runInSharedTerminal(getTasteCliShellCommand(this.extensionUri, this.getOptions().tasteDockerImage), dirnameUri(document.uri));
                    break;
                }
                case 'buildRun': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'run', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'build': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'make', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'runDebug': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'debugRun', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'runRelease': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    runInSharedTerminal(getProjectCommand(this.getOptions().useTasteCliShForCommands, this.getOptions().tasteDockerImage, 'releaseRun', this.extensionUri), dirnameUri(document.uri));
                    break;
                }
                case 'editFunction': {
                    await this.openFunctionSource(document, msg.id);
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
                        const opts: EditorOptions = { ...this.getOptions(), attrFilePath: serializeUriForSetting(uris[0]) };
                        await this.saveOptions(opts);
                        webviewPanel.webview.postMessage({ type: 'options', options: opts } as ExtensionMessage);
                        await document.loadSchemaFromPath(opts.attrFilePath);
                        this.sendDiagram(webviewPanel.webview, document);
                    }
                    break;
                }
                case 'requestExport': {
                    const defaultUri = joinPathSegments(dirnameUri(document.uri), 'diagram.png');
                    const saveUri = await vscode.window.showSaveDialog({
                        defaultUri,
                        filters: {
                            'PNG image': ['png'],
                            'SVG image': ['svg'],
                        },
                        title: 'Export Diagram as Image',
                    });
                    if (!saveUri) { break; }

                    const ext = extname(saveUri).toLowerCase();
                    const format: 'png' | 'svg' = ext === '.svg' ? 'svg' : 'png';
                    pendingExport = { uri: saveUri, format };
                    webviewPanel.webview.postMessage({ type: 'requestExport', format } as ExtensionMessage);
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
                    if (!pendingExport) { break; }
                    const bytes = await dataUrlToBytes(msg.dataUrl);
                    await vscode.workspace.fs.writeFile(pendingExport.uri, bytes);
                    vscode.window.showInformationMessage(`Diagram exported to ${basename(pendingExport.uri)}`);
                    pendingExport = null;
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

        const maxDepth = (this.getOptions().undoDepth ?? 100);
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
        log(`saveCustomDocument: ${document.uri.toString()}`);
        const { ivXml, uiXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(document.uri, encodeUtf8(ivXml));
        const uiUri = joinPathSegments(dirnameUri(document.uri), document.iv.uiFile);
        await vscode.workspace.fs.writeFile(uiUri, encodeUtf8(uiXml));
        log('saveCustomDocument: done');
    }

    async saveCustomDocumentAs(
        document: InterfaceViewDocument,
        destination: vscode.Uri,
        _cancellation: vscode.CancellationToken,
    ): Promise<void> {
        log(`saveCustomDocumentAs: ${destination.toString()}`);
        const { ivXml, uiXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(destination, encodeUtf8(ivXml));
        // Write UI file alongside the destination
        const uiUri = joinPathSegments(dirnameUri(destination), document.iv.uiFile);
        await vscode.workspace.fs.writeFile(uiUri, encodeUtf8(uiXml));
        log('saveCustomDocumentAs: done');
    }

    async revertCustomDocument(document: InterfaceViewDocument): Promise<void> {
        log(`revertCustomDocument: ${document.uri.toString()}`);
        await document.reload();
        const wv = this._webviews.get(document.uri.toString());
        if (wv) { this.sendDiagram(wv, document); }
    }

    async backupCustomDocument(
        document: InterfaceViewDocument,
        context: vscode.CustomDocumentBackupContext,
    ): Promise<vscode.CustomDocumentBackup> {
        const { ivXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(context.destination, encodeUtf8(ivXml));
        return { id: context.destination.toString(), delete: () => undefined };
    }

    // ── HTML ───────────────────────────────────────────────────────────────

    private getHtml(webview: vscode.Webview): string {
        const base = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
        const jsFiles = [webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', 'main.js'))];
        const cssFiles = [webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', 'main.css'))];

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

