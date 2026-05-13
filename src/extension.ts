import * as vscode from 'vscode';
import { InterfaceViewEditorProvider } from './editor/InterfaceViewEditorProvider';
import { log, showLog } from './logger';
import { serializeIvXml } from './serializers/IvXmlSerializer';
import { IvModel } from './model/types';
import { basename, dirnameUri, extname, joinPathSegments } from './utils/platform';

function createEmptyIvModel(): IvModel {
    return {
        version: '1.3',
        asn1file: '',
        uiFile: 'interfaceview.ui.xml',
        modifierHash: '',
        functions: [],
        connections: [],
        comments: [],
        layers: [{ name: 'default', isVisible: true }],
        unknownXmlAttrs: {},
    };
}

async function statOrUndefined(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
        return await vscode.workspace.fs.stat(uri);
    } catch {
        return undefined;
    }
}

async function resolveTargetDirectory(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (resource) {
        const stat = await statOrUndefined(resource);
        if (stat?.type === vscode.FileType.Directory) {
            return resource;
        }
        if (stat?.type === vscode.FileType.File) {
            return dirnameUri(resource);
        }
        if (!extname(resource)) {
            return resource;
        }
        return dirnameUri(resource);
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri && activeUri.scheme !== 'output') {
        return dirnameUri(activeUri);
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function createIvInDirectory(resource?: vscode.Uri): Promise<void> {
    const targetDir = await resolveTargetDirectory(resource);
    if (!targetDir) {
        void vscode.window.showErrorMessage('No target directory is available for interfaceview.xml.');
        return;
    }

    const targetFile = joinPathSegments(targetDir, 'interfaceview.xml');
    if (await statOrUndefined(targetFile)) {
        void vscode.window.showErrorMessage(`interfaceview.xml already exists in ${basename(targetDir)}.`);
        return;
    }

    const ivXml = serializeIvXml(createEmptyIvModel());
    await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(ivXml));
    const document = await vscode.workspace.openTextDocument(targetFile);
    await vscode.window.showTextDocument(document, { preview: false });
}

export function activate(context: vscode.ExtensionContext): void {
    showLog();
    log(`activate — extensionUri: ${context.extensionUri.fsPath}`);
    try {
        context.subscriptions.push(
            vscode.window.registerCustomEditorProvider(
                InterfaceViewEditorProvider.viewType,
                new InterfaceViewEditorProvider(context),
                { supportsMultipleEditorsPerDocument: false },
            ),
            vscode.commands.registerCommand('vscive.createIv', async (resource?: vscode.Uri) => {
                await createIvInDirectory(resource);
            }),
        );
        log('registerCustomEditorProvider OK');
    } catch (err) {
        log(`registerCustomEditorProvider FAILED: ${err}`);
        vscode.window.showErrorMessage(`vscive activate failed: ${err}`);
        throw err;
    }
}

export function deactivate(): void {
    log('deactivate');
}
