import * as vscode from 'vscode';
import { log } from '../logger';
import { DvDiagramData, DvExtensionMessage, DvWebviewMessage, EditorOptions, DEFAULT_OPTIONS } from '../model/types';
import { basename, dataUrlToBytes, dirnameUri, encodeUtf8, extname, joinPathSegments, serializeUriForSetting } from '../utils/platform';
import { DeploymentViewDocument } from './DeploymentViewDocument';

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getDvBuildTarget(document: DeploymentViewDocument): string {
    const filename = basename(document.uri);
    if (/\.dv\.xml$/iu.test(filename)) {
        return filename.replace(/\.dv\.xml$/iu, '');
    }
    if (/\.xml$/iu.test(filename)) {
        return filename.replace(/\.xml$/iu, '');
    }
    return filename;
}

function getDvBuildCommand(document: DeploymentViewDocument, useTasteCliShForCommands: boolean, mode: 'clean' | 'skeletons' | 'debug' | 'release', extensionUri: vscode.Uri): string {
    const target = getDvBuildTarget(document);
    const command = mode === 'clean'
        ? 'make clean'
        : mode === 'skeletons'
            ? 'make skeletons'
            : `make ${shellQuote(target)} ${mode}`;
    if (!useTasteCliShForCommands) {
        return command;
    }

    const scriptPath = joinPathSegments(extensionUri, 'scripts', 'taste-cli.sh').fsPath;
    return `bash ${shellQuote(scriptPath)} ${command}`;
}

export class DeploymentViewEditorProvider implements vscode.CustomEditorProvider<DeploymentViewDocument> {
    static readonly viewType = 'vscive.deploymentViewEditor';

    private readonly onDidChangeCustomDocumentEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<DeploymentViewDocument>>();
    readonly onDidChangeCustomDocument = this.onDidChangeCustomDocumentEmitter.event;

    private readonly webviews = new Map<string, vscode.Webview>();

    constructor(private readonly context: vscode.ExtensionContext) {}

    private getCapabilities(): { canBrowseBoardsFile: boolean; canBuild: boolean } {
        const isWebUi = vscode.env.uiKind === vscode.UIKind.Web;
        return {
            canBrowseBoardsFile: true,
            canBuild: !isWebUi,
        };
    }

    async openCustomDocument(uri: vscode.Uri): Promise<DeploymentViewDocument> {
        return DeploymentViewDocument.create(uri);
    }

    async resolveCustomEditor(document: DeploymentViewDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview')],
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        const key = document.uri.toString();
        this.webviews.set(key, webviewPanel.webview);
        webviewPanel.onDidDispose(() => this.webviews.delete(key));

        let pendingExport: { uri: vscode.Uri; format: 'png' | 'svg' } | null = null;

        webviewPanel.webview.onDidReceiveMessage(async (message: DvWebviewMessage) => {
            switch (message.type) {
                case 'ready': {
                    const options = this.getOptions();
                    await document.loadBoardsFromPath(options.boardsFilePath);
                    webviewPanel.webview.postMessage({ type: 'capabilitiesDv', capabilities: this.getCapabilities() } satisfies DvExtensionMessage);
                    webviewPanel.webview.postMessage({ type: 'options', options } satisfies DvExtensionMessage);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'nodesMoved': {
                    const before = document.snapshot();
                    document.moveNodes(message.moves);
                    this.fireEdit(document, before);
                    break;
                }
                case 'addDvNode': {
                    const before = document.snapshot();
                    document.addNode(message.id, message.boardType, message.boardName, message.rfX, message.rfY);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'deleteDvEntities': {
                    const before = document.snapshot();
                    document.deleteEntities(message.nodeIds, message.deviceIds, message.connectionIds);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'updateDvNode': {
                    const before = document.snapshot();
                    document.updateNode(message.id, { name: message.name, nodeLabel: message.nodeLabel, partitionName: message.partitionName, extraAttrs: message.extraAttrs });
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'updateDvDevice': {
                    const before = document.snapshot();
                    document.updateDevice(message.nodeId, message.id, message.patch);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'updateDvConnection': {
                    const before = document.snapshot();
                    document.updateConnection(message.id, message.patch);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'connectDvDevices': {
                    const before = document.snapshot();
                    document.connectDevices(message.id, message.fromNodeId, message.fromDeviceId, message.toNodeId, message.toDeviceId);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'deployDvFunctions': {
                    const before = document.snapshot();
                    document.deployFunctions(message.nodeId, message.functionIds);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'undeployDvFunctions': {
                    const before = document.snapshot();
                    document.undeployFunctions(message.nodeId, message.functionIds);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'deployDvMessages': {
                    const before = document.snapshot();
                    document.deployMessages(message.connectionId, message.messageIds);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'undeployDvMessages': {
                    const before = document.snapshot();
                    document.undeployMessages(message.connectionId, message.messageIds);
                    this.fireEdit(document, before);
                    this.sendDiagram(webviewPanel.webview, document);
                    break;
                }
                case 'buildDv': {
                    if (!this.getCapabilities().canBuild) {
                        break;
                    }
                    const terminal = vscode.window.createTerminal({
                        name: message.mode === 'release'
                            ? 'Build Release'
                            : message.mode === 'debug'
                                ? 'Build Debug'
                                : message.mode === 'clean'
                                    ? 'Build Clean'
                                    : 'Build Skeletons',
                        cwd: dirnameUri(document.uri),
                    });
                    terminal.sendText(getDvBuildCommand(document, this.getOptions().useTasteCliShForCommands, message.mode, this.context.extensionUri));
                    terminal.show();
                    break;
                }
                case 'updateOptions': {
                    const previous = this.getOptions();
                    await this.saveOptions(message.options);
                    if (message.options.boardsFilePath !== previous.boardsFilePath) {
                        await document.loadBoardsFromPath(message.options.boardsFilePath);
                        this.sendDiagram(webviewPanel.webview, document);
                    }
                    break;
                }
                case 'browseBoardsFile': {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: { 'XML files': ['xml'], 'All files': ['*'] },
                        title: 'Select boards file',
                    });
                    if (uris && uris.length > 0) {
                        const options = { ...this.getOptions(), boardsFilePath: serializeUriForSetting(uris[0]) };
                        await this.saveOptions(options);
                        await document.loadBoardsFromPath(options.boardsFilePath);
                        webviewPanel.webview.postMessage({ type: 'options', options } satisfies DvExtensionMessage);
                        this.sendDiagram(webviewPanel.webview, document);
                    }
                    break;
                }
                case 'requestExport': {
                    const defaultUri = joinPathSegments(dirnameUri(document.uri), 'deploymentview.png');
                    const saveUri = await vscode.window.showSaveDialog({
                        defaultUri,
                        filters: { 'PNG image': ['png'], 'SVG image': ['svg'] },
                        title: 'Export Deployment View as Image',
                    });
                    if (!saveUri) { break; }
                    const format: 'png' | 'svg' = extname(saveUri).toLowerCase() === '.svg' ? 'svg' : 'png';
                    pendingExport = { uri: saveUri, format };
                    webviewPanel.webview.postMessage({ type: 'requestExport', format } satisfies DvExtensionMessage);
                    break;
                }
                case 'exportImage': {
                    if (!pendingExport) { break; }
                    await vscode.workspace.fs.writeFile(pendingExport.uri, await dataUrlToBytes(message.dataUrl));
                    pendingExport = null;
                    break;
                }
            }
        });
    }

    async saveCustomDocument(document: DeploymentViewDocument): Promise<void> {
        const { dvXml, uiXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(document.uri, encodeUtf8(dvXml));
        await vscode.workspace.fs.writeFile(joinPathSegments(dirnameUri(document.uri), document.dv.uiFile), encodeUtf8(uiXml));
    }

    async saveCustomDocumentAs(document: DeploymentViewDocument, destination: vscode.Uri): Promise<void> {
        const { dvXml, uiXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(destination, encodeUtf8(dvXml));
        await vscode.workspace.fs.writeFile(joinPathSegments(dirnameUri(destination), document.dv.uiFile), encodeUtf8(uiXml));
    }

    async revertCustomDocument(document: DeploymentViewDocument): Promise<void> {
        await document.reload();
        const webview = this.webviews.get(document.uri.toString());
        if (webview) {
            this.sendDiagram(webview, document);
        }
    }

    async backupCustomDocument(document: DeploymentViewDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
        const { dvXml } = document.serializeToXml();
        await vscode.workspace.fs.writeFile(context.destination, encodeUtf8(dvXml));
        return { id: context.destination.toString(), delete: () => undefined };
    }

    private fireEdit(document: DeploymentViewDocument, before: ReturnType<DeploymentViewDocument['snapshot']>): void {
        const after = document.snapshot();
        this.onDidChangeCustomDocumentEmitter.fire({
            document,
            undo: async () => {
                document.restore(before);
                const webview = this.webviews.get(document.uri.toString());
                if (webview) {
                    this.sendDiagram(webview, document);
                }
            },
            redo: async () => {
                document.restore(after);
                const webview = this.webviews.get(document.uri.toString());
                if (webview) {
                    this.sendDiagram(webview, document);
                }
            },
        });
    }

    private sendDiagram(webview: vscode.Webview, document: DeploymentViewDocument): void {
        const data: DvDiagramData = {
            dv: document.dv,
            ui: document.ui,
            boards: document.boards,
            availableFunctions: document.availableFunctions,
            availableMessages: document.availableMessages,
        };
        webview.postMessage({ type: 'loadDv', data } satisfies DvExtensionMessage);
    }

    private getOptions(): EditorOptions {
        return { ...DEFAULT_OPTIONS, ...this.context.globalState.get<Partial<EditorOptions>>('editorOptions', DEFAULT_OPTIONS) };
    }

    private async saveOptions(options: EditorOptions): Promise<void> {
        await this.context.globalState.update('editorOptions', options);
    }

    private getHtml(webview: vscode.Webview): string {
        const base = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', 'main.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', 'main.css'));
        const csp = `default-src 'none'; img-src data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="${csp}"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="stylesheet" href="${style}"/>
  <style>html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style>
</head>
<body data-editor-kind="dv">
  <div id="root"></div>
  <script type="module" src="${script}"></script>
</body>
</html>`;
    }
}