import * as vscode from 'vscode';
import { log } from '../logger';
import {
    DEFAULT_OPTIONS,
    EditorOptions,
    SdlDiagramData,
    SdlExtensionMessage,
    SdlWebviewMessage,
} from '../model/types';
import { dataUrlToBytes, encodeUtf8, joinPathSegments } from '../utils/platform';
import { resolveEditorOptions } from '../utils/editorOptions';
import { SdlEditorDocument } from './SdlEditorDocument';

export class SdlEditorProvider implements vscode.CustomEditorProvider<SdlEditorDocument> {
    static readonly viewType = 'vscive.sdlEditor';

    private readonly onDidChangeCustomDocumentEmitter =
        new vscode.EventEmitter<vscode.CustomDocumentEditEvent<SdlEditorDocument>>();
    readonly onDidChangeCustomDocument = this.onDidChangeCustomDocumentEmitter.event;

    private readonly webviews = new Map<string, vscode.Webview>();

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(uri: vscode.Uri): Promise<SdlEditorDocument> {
        return SdlEditorDocument.create(uri);
    }

    async resolveCustomEditor(
        document: SdlEditorDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview')],
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        const key = document.uri.toString();
        this.webviews.set(key, webviewPanel.webview);
        webviewPanel.onDidDispose(() => this.webviews.delete(key));

        webviewPanel.webview.onDidReceiveMessage(async (message: SdlWebviewMessage) => {
            switch (message.type) {
                case 'ready': {
                    const options = this.getOptions();
                    webviewPanel.webview.postMessage(
                        { type: 'options', options } satisfies SdlExtensionMessage,
                    );
                    this.sendDiagram(webviewPanel.webview, document);
                    return;
                }

                case 'sdlSymbolMoved': {
                    const before = document.snapshot();
                    document.moveSymbol(message.id, message.x, message.y, message.w, message.h);
                    this.fireEdit(document, before);
                    return;
                }

                case 'sdlTextEdited': {
                    const before = document.snapshot();
                    document.editSymbolText(message.id, message.text);
                    this.fireEdit(document, before);
                    return;
                }

                case 'updateOptions': {
                    await this.saveOptions(message.options);
                    // Propagate to all open SDL webviews
                    for (const wv of this.webviews.values()) {
                        wv.postMessage(
                            { type: 'options', options: message.options } satisfies SdlExtensionMessage,
                        );
                    }
                    return;
                }

                case 'requestExport': {
                    webviewPanel.webview.postMessage(
                        { type: 'requestExport', format: 'png' } satisfies SdlExtensionMessage,
                    );
                    return;
                }

                case 'exportImage': {
                    const bytes = await dataUrlToBytes(message.dataUrl);
                    const ext = message.format === 'svg' ? '.svg' : '.png';
                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(document.uri.fsPath + ext),
                        filters: message.format === 'svg'
                            ? { 'SVG Image': ['svg'] }
                            : { 'PNG Image': ['png'] },
                    });
                    if (uri) {
                        await vscode.workspace.fs.writeFile(uri, bytes);
                    }
                    return;
                }

                default:
                    log(`SDL: unknown message type: ${(message as { type: string }).type}`);
            }
        });
    }

    async saveCustomDocument(
        document: SdlEditorDocument,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        await document.save(cancellation);
    }

    async saveCustomDocumentAs(
        document: SdlEditorDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        await document.saveAs(destination, cancellation);
    }

    async revertCustomDocument(document: SdlEditorDocument): Promise<void> {
        await document.reload();
        const webview = this.webviews.get(document.uri.toString());
        if (webview) this.sendDiagram(webview, document);
    }

    async backupCustomDocument(
        document: SdlEditorDocument,
        context: vscode.CustomDocumentBackupContext,
    ): Promise<vscode.CustomDocumentBackup> {
        const content = document.sdl.lines.join('\n');
        await vscode.workspace.fs.writeFile(context.destination, encodeUtf8(content));
        return { id: context.destination.toString(), delete: () => undefined };
    }

    private fireEdit(
        document: SdlEditorDocument,
        before: ReturnType<SdlEditorDocument['snapshot']>,
    ): void {
        const after = document.snapshot();
        this.onDidChangeCustomDocumentEmitter.fire({
            document,
            undo: async () => {
                document.restore(before);
                const webview = this.webviews.get(document.uri.toString());
                if (webview) this.sendDiagram(webview, document);
            },
            redo: async () => {
                document.restore(after);
                const webview = this.webviews.get(document.uri.toString());
                if (webview) this.sendDiagram(webview, document);
            },
        });
    }

    private sendDiagram(webview: vscode.Webview, document: SdlEditorDocument): void {
        const data: SdlDiagramData = { sdl: document.sdl };
        webview.postMessage({ type: 'loadSdl', data } satisfies SdlExtensionMessage);
    }

    private getOptions(): EditorOptions {
        const saved = this.context.globalState.get<Partial<EditorOptions>>(
            'editorOptions',
            DEFAULT_OPTIONS,
        );
        return resolveEditorOptions(saved);
    }

    private async saveOptions(options: EditorOptions): Promise<void> {
        await this.context.globalState.update('editorOptions', options);
    }

    private getHtml(webview: vscode.Webview): string {
        const base = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', 'main.js'));
        const style  = webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', 'main.css'));
        const csp = [
            `default-src 'none'`,
            `img-src data:`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src ${webview.cspSource}`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="${csp}"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="stylesheet" href="${style}"/>
  <style>html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style>
</head>
<body data-editor-kind="sdl">
  <div id="root"></div>
  <script type="module" src="${script}"></script>
</body>
</html>`;
    }
}
