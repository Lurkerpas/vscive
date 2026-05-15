import * as vscode from 'vscode';
import { DeploymentViewEditorProvider } from './editor/DeploymentViewEditorProvider';
import { InterfaceViewEditorProvider } from './editor/InterfaceViewEditorProvider';
import { log, showLog } from './logger';
import { DvModel, DEFAULT_OPTIONS, EditorOptions, IvModel } from './model/types';
import { serializeDvXml } from './serializers/DvXmlSerializer';
import { serializeIvXml } from './serializers/IvXmlSerializer';
import { basename, dirnameUri, extname, joinPathSegments } from './utils/platform';
import { runInSharedTerminal } from './utils/terminal';

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

function createEmptyDvModel(): DvModel {
    return {
        version: '1.0',
        uiFile: 'deploymentview.ui.xml',
        creatorHash: '',
        modifierHash: '',
        nodes: [],
        connections: [],
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

async function createDvInDirectory(resource?: vscode.Uri): Promise<void> {
    const targetDir = await resolveTargetDirectory(resource);
    if (!targetDir) {
        void vscode.window.showErrorMessage('No target directory is available for deploymentview.dv.xml.');
        return;
    }

    const targetFile = joinPathSegments(targetDir, 'deploymentview.dv.xml');
    if (await statOrUndefined(targetFile)) {
        void vscode.window.showErrorMessage(`deploymentview.dv.xml already exists in ${basename(targetDir)}.`);
        return;
    }

    const dvXml = serializeDvXml(createEmptyDvModel());
    await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(dvXml));
    const document = await vscode.workspace.openTextDocument(targetFile);
    await vscode.window.showTextDocument(document, { preview: false });
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getTasteDockerImage(context: vscode.ExtensionContext): string {
    const saved = context.globalState.get<Partial<EditorOptions>>('editorOptions', DEFAULT_OPTIONS);
    return saved.tasteDockerImage ?? DEFAULT_OPTIONS.tasteDockerImage;
}

function wrapTasteCliCommand(context: vscode.ExtensionContext, command: string): string {
    const tasteCliPath = joinPathSegments(context.extensionUri, 'scripts', 'taste-cli.sh').fsPath;
    return `TASTE_DOCKER_IMAGE=${shellQuote(getTasteDockerImage(context))} bash ${shellQuote(tasteCliPath)} ${command}`;
}

function getUseTasteCliShForCommands(context: vscode.ExtensionContext): boolean {
    const saved = context.globalState.get<Partial<EditorOptions> & { useDockerWrapperForCommands?: boolean }>('editorOptions', DEFAULT_OPTIONS);
    const configured = vscode.workspace
        .getConfiguration('vscive')
        .get<boolean>(
            'useTasteCliShForCommands',
            vscode.workspace
                .getConfiguration('vscive')
                .get<boolean>('useDockerWrapperForCommands', DEFAULT_OPTIONS.useTasteCliShForCommands),
        );
    return saved.useTasteCliShForCommands ?? saved.useDockerWrapperForCommands ?? configured;
}

function getTasteInitCommand(context: vscode.ExtensionContext): string {
    const tasteInitHerePath = joinPathSegments(context.extensionUri, 'scripts', 'taste-init-here.sh').fsPath;
    if (!getUseTasteCliShForCommands(context)) {
        return `bash ${shellQuote(tasteInitHerePath)}`;
    }

    return wrapTasteCliCommand(context, `bash -s -- < ${shellQuote(tasteInitHerePath)}`);
}

async function runTasteInitHere(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
    const targetDir = await resolveTargetDirectory(resource);
    if (!targetDir) {
        void vscode.window.showErrorMessage('No target directory is available for taste-init-here.sh.');
        return;
    }

    runInSharedTerminal(getTasteInitCommand(context), targetDir);
}

function getWrappedCommand(context: vscode.ExtensionContext, command: string): string {
    if (!getUseTasteCliShForCommands(context)) {
        return command;
    }

    return wrapTasteCliCommand(context, command);
}

async function runTerminalCommand(context: vscode.ExtensionContext, terminalName: string, command: string, resource?: vscode.Uri): Promise<void> {
    const targetDir = await resolveTargetDirectory(resource);
    if (!targetDir) {
        void vscode.window.showErrorMessage(`No target directory is available for ${terminalName}.`);
        return;
    }

    runInSharedTerminal(getWrappedCommand(context, command), targetDir);
}

async function resolveDeploymentViewTarget(resource?: vscode.Uri): Promise<{ targetDir: vscode.Uri; targetName: string } | undefined> {
    const resourceStat = resource ? await statOrUndefined(resource) : undefined;
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const resourceIsDvFile = resourceStat?.type === vscode.FileType.File && !!resource && /\.dv\.xml$/iu.test(basename(resource));
    if (resourceIsDvFile && resource) {
        return { targetDir: dirnameUri(resource), targetName: basename(resource).replace(/\.dv\.xml$/iu, '') };
    }

    if (activeUri && /\.dv\.xml$/iu.test(basename(activeUri))) {
        const activeDir = dirnameUri(activeUri);
        const targetDir = await resolveTargetDirectory(resource);
        if (!targetDir || activeDir.toString() === targetDir.toString()) {
            return { targetDir: activeDir, targetName: basename(activeUri).replace(/\.dv\.xml$/iu, '') };
        }
    }

    const targetDir = await resolveTargetDirectory(resource);
    if (!targetDir) {
        return undefined;
    }

    const dvFiles = (await vscode.workspace.fs.readDirectory(targetDir))
        .filter(([name, type]) => type === vscode.FileType.File && /\.dv\.xml$/iu.test(name))
        .map(([name]) => name);

    if (dvFiles.length === 0) {
        void vscode.window.showErrorMessage(`No *.dv.xml file was found in ${basename(targetDir)}.`);
        return undefined;
    }
    if (dvFiles.length > 1) {
        void vscode.window.showErrorMessage(`Multiple *.dv.xml files were found in ${basename(targetDir)}. Open the desired Deployment View file first, or run the command on that file.`);
        return undefined;
    }

    return { targetDir, targetName: dvFiles[0].replace(/\.dv\.xml$/iu, '') };
}

async function runTasteBuildCommand(context: vscode.ExtensionContext, resource: vscode.Uri | undefined, action: 'release' | 'debug' | 'clean' | 'skeletons'): Promise<void> {
    const command = action === 'release'
        ? 'make release'
        : action === 'debug'
            ? 'make debug'
            : action === 'clean'
                ? 'make clean'
                : 'make skeletons';
    const terminalName = action === 'release'
        ? 'TASTE Build Release'
        : action === 'debug'
            ? 'TASTE Build Debug'
            : action === 'clean'
                ? 'TASTE Build Clean'
                : 'TASTE Build Skeletons';
    await runTerminalCommand(context, terminalName, command, resource);
}

async function runTasteRunCommand(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
    await runTerminalCommand(context, 'TASTE Run', 'make run', resource);
}

async function runTasteDvBuildCommand(context: vscode.ExtensionContext, resource: vscode.Uri | undefined, action: 'release' | 'debug'): Promise<void> {
    const target = await resolveDeploymentViewTarget(resource);
    if (!target) {
        return;
    }

    runInSharedTerminal(getWrappedCommand(context, `make ${shellQuote(target.targetName)} ${action}`), target.targetDir);
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
            vscode.window.registerCustomEditorProvider(
                DeploymentViewEditorProvider.viewType,
                new DeploymentViewEditorProvider(context),
                { supportsMultipleEditorsPerDocument: false },
            ),
            vscode.commands.registerCommand('vscive.createIv', async (resource?: vscode.Uri) => {
                await createIvInDirectory(resource);
            }),
            vscode.commands.registerCommand('vscive.createDv', async (resource?: vscode.Uri) => {
                await createDvInDirectory(resource);
            }),
            vscode.commands.registerCommand('vscive.tasteInitHere', async (resource?: vscode.Uri) => {
                await runTasteInitHere(context, resource);
            }),
            vscode.commands.registerCommand('vscive.tasteBuildRelease', async (resource?: vscode.Uri) => {
                await runTasteBuildCommand(context, resource, 'release');
            }),
            vscode.commands.registerCommand('vscive.tasteBuildDebug', async (resource?: vscode.Uri) => {
                await runTasteBuildCommand(context, resource, 'debug');
            }),
            vscode.commands.registerCommand('vscive.tasteBuildClean', async (resource?: vscode.Uri) => {
                await runTasteBuildCommand(context, resource, 'clean');
            }),
            vscode.commands.registerCommand('vscive.tasteBuildDvRelease', async (resource?: vscode.Uri) => {
                await runTasteDvBuildCommand(context, resource, 'release');
            }),
            vscode.commands.registerCommand('vscive.tasteBuildDvDebug', async (resource?: vscode.Uri) => {
                await runTasteDvBuildCommand(context, resource, 'debug');
            }),
            vscode.commands.registerCommand('vscive.tasteBuildSkeletons', async (resource?: vscode.Uri) => {
                await runTasteBuildCommand(context, resource, 'skeletons');
            }),
            vscode.commands.registerCommand('vscive.tasteRun', async (resource?: vscode.Uri) => {
                await runTasteRunCommand(context, resource);
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
