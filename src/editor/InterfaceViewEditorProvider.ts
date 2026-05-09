import * as vscode from 'vscode';
import * as path from 'path';
import { InterfaceViewDocument } from './InterfaceViewDocument';
import { DiagramData, ExtensionMessage, WebviewMessage } from '../model/types';

export class InterfaceViewEditorProvider
    implements vscode.CustomEditorProvider<InterfaceViewDocument> {

    static readonly viewType = 'vscive.interfaceViewEditor';

    private readonly _onDidChangeCustomDocument =
        new vscode.EventEmitter<vscode.CustomDocumentEditEvent<InterfaceViewDocument>>();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    constructor(private readonly extensionUri: vscode.Uri) { }

    async openCustomDocument(uri: vscode.Uri): Promise<InterfaceViewDocument> {
        return InterfaceViewDocument.create(uri);
    }

    async resolveCustomEditor(
        document: InterfaceViewDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
            if (msg.type === 'ready') {
                this.sendDiagram(webviewPanel.webview, document);
            }
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

    // ── CustomEditorProvider stubs (read-only MVP) ─────────────────────────

    async saveCustomDocument(): Promise<void> { }
    async saveCustomDocumentAs(): Promise<void> { }
    async revertCustomDocument(): Promise<void> { }
    async backupCustomDocument(
        document: InterfaceViewDocument,
        context: vscode.CustomDocumentBackupContext,
    ): Promise<vscode.CustomDocumentBackup> {
        return { id: context.destination.toString(), delete: () => undefined };
    }

    // ── HTML ───────────────────────────────────────────────────────────────

    private getHtml(webview: vscode.Webview): string {
        const base = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
        // Vite produces assets/index-*.js and assets/index-*.css — glob them
        const jsFiles = (() => {
            try {
                const fs = require('fs') as typeof import('fs');
                const assetsDir = path.join(base.fsPath, 'assets');
                return fs.readdirSync(assetsDir)
                    .filter((f: string) => f.endsWith('.js'))
                    .map((f: string) => webview.asWebviewUri(vscode.Uri.joinPath(base, 'assets', f)));
            } catch { return []; }
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

        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};`;
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
