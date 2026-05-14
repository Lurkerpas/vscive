import * as vscode from 'vscode';
import { parseBoardsXml } from '../parsers/BoardsXmlParser';
import { parseDvXml } from '../parsers/DvXmlParser';
import { parseIvXml } from '../parsers/IvXmlParser';
import { parseUiXml } from '../parsers/UiXmlParser';
import { serializeDvXml } from '../serializers/DvXmlSerializer';
import { serializeUiXml } from '../serializers/UiXmlSerializer';
import {
    BoardModel,
    BoardsFileModel,
    DV_LAYOUT_SCALE,
    DvAvailableFunction,
    DvAvailableMessage,
    DvConnectionModel,
    DvDeviceModel,
    DvModel,
    DvNodeMove,
    EntityLayout,
    UiModel,
} from '../model/types';
import { decodeUtf8 } from '../utils/platform';
import { basenameWithoutExtension, createUuid, dirnameUri, joinPathSegments, parseStoredUriOrPath } from '../utils/platform';

const DV_SC_INV = 1 / DV_LAYOUT_SCALE;
const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 220;
const DEFAULT_DEVICE_WIDTH = 92;
const DEFAULT_DEVICE_HEIGHT = 28;

async function statOrUndefined(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
        return await vscode.workspace.fs.stat(uri);
    } catch {
        return undefined;
    }
}

export class DeploymentViewDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    dv!: DvModel;
    ui!: UiModel;
    boards: BoardsFileModel = { boards: [] };
    availableFunctions: DvAvailableFunction[] = [];
    availableMessages: DvAvailableMessage[] = [];

    private constructor(uri: vscode.Uri) {
        this.uri = uri;
    }

    dispose(): void {
        // No-op: document state is managed entirely in memory.
    }

    static async create(uri: vscode.Uri): Promise<DeploymentViewDocument> {
        const document = new DeploymentViewDocument(uri);
        await document.reload();
        await document.loadBoards();
        return document;
    }

    async reload(): Promise<void> {
        const xmlBytes = await vscode.workspace.fs.readFile(this.uri);
        this.dv = parseDvXml(decodeUtf8(xmlBytes));

        if (!this.dv.uiFile) {
            const baseName = basenameWithoutExtension(this.uri).replace(/\.dv$/u, '');
            this.dv.uiFile = `${baseName || 'deploymentview'}.ui.xml`;
            this.ui = { version: '1.0', entities: {} };
        } else {
            const uiUri = joinPathSegments(dirnameUri(this.uri), this.dv.uiFile);
            try {
                const uiBytes = await vscode.workspace.fs.readFile(uiUri);
                this.ui = parseUiXml(decodeUtf8(uiBytes));
            } catch {
                this.ui = { version: '1.0', entities: {} };
            }
        }

        this.ensureLayoutEntries();
        await this.loadAvailableDeploymentItems();
    }

    async loadBoards(): Promise<void> {
        await this.loadBoardsFromPath('');
    }

    async loadBoardsFromPath(boardsFilePath: string): Promise<void> {
        const configuredPath = boardsFilePath || vscode.workspace.getConfiguration('vscive').get<string>('boardsFilePath') || '';
        const boardsUri = parseStoredUriOrPath(configuredPath);
        if (!boardsUri) {
            this.boards = { boards: [] };
            return;
        }

        try {
            const xml = decodeUtf8(await vscode.workspace.fs.readFile(boardsUri));
            this.boards = parseBoardsXml(xml);
        } catch {
            this.boards = { boards: [] };
        }
    }

    serializeToXml(): { dvXml: string; uiXml: string } {
        return {
            dvXml: serializeDvXml(this.dv),
            uiXml: serializeUiXml(this.ui),
        };
    }

    snapshot(): { dv: DvModel; ui: UiModel; availableFunctions: DvAvailableFunction[]; availableMessages: DvAvailableMessage[] } {
        return {
            dv: JSON.parse(JSON.stringify(this.dv)) as DvModel,
            ui: JSON.parse(JSON.stringify(this.ui)) as UiModel,
            availableFunctions: JSON.parse(JSON.stringify(this.availableFunctions)) as DvAvailableFunction[],
            availableMessages: JSON.parse(JSON.stringify(this.availableMessages)) as DvAvailableMessage[],
        };
    }

    restore(snapshot: { dv: DvModel; ui: UiModel; availableFunctions: DvAvailableFunction[]; availableMessages: DvAvailableMessage[] }): void {
        this.dv = JSON.parse(JSON.stringify(snapshot.dv)) as DvModel;
        this.ui = JSON.parse(JSON.stringify(snapshot.ui)) as UiModel;
        this.availableFunctions = JSON.parse(JSON.stringify(snapshot.availableFunctions)) as DvAvailableFunction[];
        this.availableMessages = JSON.parse(JSON.stringify(snapshot.availableMessages)) as DvAvailableMessage[];
    }

    moveNodes(moves: DvNodeMove[]): void {
        for (const move of moves) {
            if (move.kind === 'node') {
                this.ui.entities[move.id] = {
                    coordinates: this.flowRectToAbsoluteSc(move.x, move.y, move.w, move.h),
                };
                continue;
            }

            if (move.parentId) {
                const center = this.flowPointToScopedSc(this.ui.entities[move.parentId], move.x + move.w / 2, move.y + move.h / 2);
                this.ui.entities[move.id] = { coordinates: [Math.round(center.x), Math.round(center.y)] };
            }
        }
    }

    addNode(id: string, boardType: string, boardName: string, rfX: number, rfY: number): void {
        const board = this.findBoard(boardType, boardName);
        const index = this.dv.nodes.length + 1;
        const partitionId = createUuid();
        const nodeName = `${board?.name || boardName || 'Node'}_${index}`;
        const node = {
            id,
            name: nodeName,
            type: board?.type || boardType,
            nodeLabel: `Node_${index}`,
            namespace: board?.namespace || '',
            partition: {
                id: partitionId,
                name: `Partition_${index}`,
                functions: [],
                properties: [],
                extraAttrs: {},
            },
            devices: (board?.ports ?? []).map((port, deviceIndex) => ({
                id: createUuid(),
                name: port.name,
                port: port.name,
                requiresBusAccess: port.requiresBusAccess,
                packetizer: port.packetizer,
                config: port.config,
                asn1file: port.asn1file,
                asn1type: port.asn1type,
                asn1module: port.asn1module,
                implExtends: port.implExtends,
                extends: port.extends,
                namespace: port.namespace,
                busNamespace: port.busNamespace,
                properties: [],
                extraAttrs: { ...port.extraAttrs },
            })),
            properties: [],
            extraAttrs: {},
        } satisfies DvModel['nodes'][number];

        this.dv.nodes.push(node);
        this.ui.entities[id] = { coordinates: this.flowRectToAbsoluteSc(rfX, rfY, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT) };
        this.ui.entities[partitionId] = { coordinates: [] };
        this.ensureDeviceLayouts(node.id, node.devices);
        this.refreshAvailableFunctionAssignments();
        this.refreshAvailableMessageAssignments();
    }

    updateNode(id: string, patch: { name?: string; nodeLabel?: string; extraAttrs?: Record<string, string> }): void {
        const node = this.dv.nodes.find(candidate => candidate.id === id);
        if (!node) { return; }
        if (patch.name !== undefined) { node.name = patch.name; }
        if (patch.nodeLabel !== undefined) { node.nodeLabel = patch.nodeLabel; }
        if (patch.extraAttrs) { node.extraAttrs = { ...node.extraAttrs, ...patch.extraAttrs }; }
        this.refreshAvailableFunctionAssignments();
    }

    updateDevice(nodeId: string, id: string, patch: Partial<Omit<DvDeviceModel, 'id' | 'properties' | 'extraAttrs'>> & { extraAttrs?: Record<string, string> }): void {
        const device = this.dv.nodes.find(node => node.id === nodeId)?.devices.find(candidate => candidate.id === id);
        if (!device) { return; }
        Object.assign(device, patch);
        if (patch.extraAttrs) {
            device.extraAttrs = { ...device.extraAttrs, ...patch.extraAttrs };
        }
    }

    updateConnection(id: string, patch: { name?: string; toBus?: string; extraAttrs?: Record<string, string> }): void {
        const connection = this.dv.connections.find(candidate => candidate.id === id);
        if (!connection) { return; }
        if (patch.name !== undefined) { connection.name = patch.name; }
        if (patch.toBus !== undefined) { connection.toBus = patch.toBus; }
        if (patch.extraAttrs) { connection.extraAttrs = { ...connection.extraAttrs, ...patch.extraAttrs }; }
        this.refreshAvailableMessageAssignments();
    }

    deleteEntities(nodeIds?: string[], deviceIds?: string[], connectionIds?: string[]): void {
        const nodeIdSet = new Set(nodeIds ?? []);
        const deviceIdSet = new Set(deviceIds ?? []);
        const connectionIdSet = new Set(connectionIds ?? []);

        if (nodeIdSet.size > 0) {
            this.dv.nodes = this.dv.nodes.filter(node => !nodeIdSet.has(node.id));
            this.dv.connections = this.dv.connections.filter(connection => !nodeIdSet.has(this.findNodeIdByName(connection.fromNode)) && !nodeIdSet.has(this.findNodeIdByName(connection.toNode)));
            for (const nodeId of nodeIdSet) {
                delete this.ui.entities[nodeId];
            }
        }

        if (deviceIdSet.size > 0) {
            for (const node of this.dv.nodes) {
                node.devices = node.devices.filter(device => !deviceIdSet.has(device.id));
            }
            this.dv.connections = this.dv.connections.filter(connection => {
                const sourceDeviceId = this.findDeviceIdByNodeAndPort(connection.fromNode, connection.fromPort);
                const targetDeviceId = this.findDeviceIdByNodeAndPort(connection.toNode, connection.toPort);
                return !deviceIdSet.has(sourceDeviceId) && !deviceIdSet.has(targetDeviceId);
            });
            for (const deviceId of deviceIdSet) {
                delete this.ui.entities[deviceId];
            }
        }

        if (connectionIdSet.size > 0) {
            this.dv.connections = this.dv.connections.filter(connection => !connectionIdSet.has(connection.id));
            for (const connectionId of connectionIdSet) {
                delete this.ui.entities[connectionId];
            }
        }

        this.refreshAvailableFunctionAssignments();
        this.refreshAvailableMessageAssignments();
    }

    connectDevices(id: string, fromNodeId: string, fromDeviceId: string, toNodeId: string, toDeviceId: string): void {
        const fromNode = this.dv.nodes.find(node => node.id === fromNodeId);
        const toNode = this.dv.nodes.find(node => node.id === toNodeId);
        const fromDevice = fromNode?.devices.find(device => device.id === fromDeviceId);
        const toDevice = toNode?.devices.find(device => device.id === toDeviceId);
        if (!fromNode || !toNode || !fromDevice || !toDevice) { return; }

        const connection: DvConnectionModel = {
            id,
            name: `Connection_${this.dv.connections.length + 1}`,
            fromNode: fromNode.name,
            fromPort: fromDevice.port || fromDevice.name,
            toBus: fromDevice.requiresBusAccess || toDevice.requiresBusAccess,
            toNode: toNode.name,
            toPort: toDevice.port || toDevice.name,
            messages: [],
            properties: [],
            extraAttrs: {},
        };
        this.dv.connections.push(connection);
        this.ui.entities[id] = {
            coordinates: this.defaultConnectionCoordinates(fromDeviceId, toDeviceId),
        };
        this.refreshAvailableMessageAssignments();
    }

    deployFunctions(nodeId: string, functionIds: string[]): void {
        const node = this.dv.nodes.find(candidate => candidate.id === nodeId);
        if (!node) { return; }

        const requested = new Set(functionIds);
        for (const candidate of this.availableFunctions.filter(item => requested.has(item.id))) {
            for (const owner of this.dv.nodes) {
                owner.partition.functions = owner.partition.functions.filter(fn => fn.id !== candidate.id);
            }
            node.partition.functions.push({
                id: candidate.id,
                name: candidate.name,
                path: candidate.path,
                properties: [],
                extraAttrs: {},
            });
        }
        node.partition.functions.sort((left, right) => left.name.localeCompare(right.name));
        this.refreshAvailableFunctionAssignments();
    }

    undeployFunctions(nodeId: string, functionIds: string[]): void {
        const node = this.dv.nodes.find(candidate => candidate.id === nodeId);
        if (!node) { return; }
        const requested = new Set(functionIds);
        node.partition.functions = node.partition.functions.filter(fn => !requested.has(fn.id));
        this.refreshAvailableFunctionAssignments();
    }

    deployMessages(connectionId: string, messageKeys: string[]): void {
        const connection = this.dv.connections.find(candidate => candidate.id === connectionId);
        if (!connection) { return; }
        const requested = new Set(messageKeys);

        for (const candidate of this.availableMessages.filter(item => requested.has(item.key))) {
            for (const owner of this.dv.connections) {
                owner.messages = owner.messages.filter(message => this.messageKey(message) !== candidate.key);
            }
            connection.messages.push({
                id: createUuid(),
                name: candidate.name || `Message_${connection.messages.length + 1}`,
                fromFunction: candidate.fromFunction,
                fromInterface: candidate.fromInterface,
                toFunction: candidate.toFunction,
                toInterface: candidate.toInterface,
                properties: [],
                extraAttrs: {},
            });
        }

        connection.messages.sort((left, right) => left.name.localeCompare(right.name));
        this.refreshAvailableMessageAssignments();
    }

    undeployMessages(connectionId: string, messageKeys: string[]): void {
        const connection = this.dv.connections.find(candidate => candidate.id === connectionId);
        if (!connection) { return; }
        const requested = new Set(messageKeys);
        connection.messages = connection.messages.filter(message => !requested.has(this.messageKey(message)));
        this.refreshAvailableMessageAssignments();
    }

    private ensureLayoutEntries(): void {
        for (const node of this.dv.nodes) {
            if (!this.ui.entities[node.id] || this.ui.entities[node.id].coordinates.length < 4) {
                this.ui.entities[node.id] = { coordinates: this.flowRectToAbsoluteSc(80 + this.dv.nodes.indexOf(node) * 360, 120, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT) };
            }
            if (!this.ui.entities[node.partition.id]) {
                this.ui.entities[node.partition.id] = { coordinates: [] };
            }
            this.ensureDeviceLayouts(node.id, node.devices);
        }
    }

    private ensureDeviceLayouts(nodeId: string, devices: DvDeviceModel[]): void {
        for (const [index, device] of devices.entries()) {
            if (this.ui.entities[device.id]?.coordinates.length === 2) {
                continue;
            }
            const nodeLayout = this.ui.entities[nodeId];
            const width = this.scRectWidth(nodeLayout.coordinates) * DV_LAYOUT_SCALE || DEFAULT_NODE_WIDTH;
            const localX = width - DEFAULT_DEVICE_WIDTH;
            const localY = 36 + index * 38;
            const center = this.flowPointToScopedSc(nodeLayout, localX + DEFAULT_DEVICE_WIDTH / 2, localY + DEFAULT_DEVICE_HEIGHT / 2);
            this.ui.entities[device.id] = { coordinates: [Math.round(center.x), Math.round(center.y)] };
        }
    }

    private async loadAvailableDeploymentItems(): Promise<void> {
        const interfaceViewUri = joinPathSegments(dirnameUri(this.uri), 'interfaceview.xml');
        if (!(await statOrUndefined(interfaceViewUri))) {
            this.availableFunctions = [];
            this.availableMessages = [];
            this.refreshAvailableFunctionAssignments();
            this.refreshAvailableMessageAssignments();
            return;
        }

        const xml = decodeUtf8(await vscode.workspace.fs.readFile(interfaceViewUri));
        const iv = parseIvXml(xml);

        const flattenedFunctions: DvAvailableFunction[] = [];
        const visit = (functions: typeof iv.functions, parentPath = ''): void => {
            for (const fn of functions) {
                const path = parentPath ? `${parentPath}/${fn.name}` : fn.name;
                if (fn.nestedFunctions.length === 0) {
                    flattenedFunctions.push({ id: fn.id, name: fn.name, path });
                    continue;
                }
                visit(fn.nestedFunctions, path);
            }
        };
        visit(iv.functions);
        this.availableFunctions = flattenedFunctions;

        this.availableMessages = iv.connections.map(connection => ({
            key: `${connection.sourceFuncName}::${connection.sourceRiName}::${connection.targetFuncName}::${connection.targetPiName}`,
            name: connection.name,
            fromFunction: connection.sourceFuncName,
            fromInterface: connection.sourceRiName,
            toFunction: connection.targetFuncName,
            toInterface: connection.targetPiName,
        }));

        this.refreshAvailableFunctionAssignments();
        this.refreshAvailableMessageAssignments();
    }

    private refreshAvailableFunctionAssignments(): void {
        const deployedFunctions = this.dv.nodes.flatMap(node =>
            node.partition.functions.map(fn => ({
                fn,
                nodeId: node.id,
                nodeName: node.name,
                assigned: false,
            })),
        );

        const assignDeployment = (candidate: Pick<DvAvailableFunction, 'id' | 'name' | 'path'>, keyOf: (item: Pick<DvAvailableFunction, 'id' | 'name' | 'path'>) => string | undefined) => {
            const candidateKey = keyOf(candidate);
            if (!candidateKey) {
                return undefined;
            }
            const match = deployedFunctions.find(entry => !entry.assigned && keyOf(entry.fn) === candidateKey);
            if (!match) {
                return undefined;
            }
            match.assigned = true;
            return match;
        };

        this.availableFunctions = this.availableFunctions.map(candidate => {
            const deployment = assignDeployment(candidate, item => this.normalizeFunctionIdentity(item.id))
                ?? assignDeployment(candidate, item => this.normalizeFunctionIdentity(item.path))
                ?? assignDeployment(candidate, item => this.normalizeFunctionIdentity(item.name));

            return {
                ...candidate,
                deployedNodeId: deployment?.nodeId,
                deployedNodeName: deployment?.nodeName,
            };
        });
    }

    private refreshAvailableMessageAssignments(): void {
        const deployedByKey = new Map<string, { connectionId: string; connectionName: string }>();
        for (const connection of this.dv.connections) {
            for (const message of connection.messages) {
                deployedByKey.set(this.messageKey(message), { connectionId: connection.id, connectionName: connection.name });
            }
        }
        this.availableMessages = this.availableMessages.map(candidate => ({
            ...candidate,
            deployedConnectionId: deployedByKey.get(candidate.key)?.connectionId,
            deployedConnectionName: deployedByKey.get(candidate.key)?.connectionName,
        }));
    }

    private messageKey(message: { fromFunction: string; fromInterface: string; toFunction: string; toInterface: string }): string {
        return `${message.fromFunction}::${message.fromInterface}::${message.toFunction}::${message.toInterface}`;
    }

    private findBoard(boardType: string, boardName: string): BoardModel | undefined {
        return this.boards.boards.find(board => board.type === boardType && (board.name === boardName || !boardName))
            ?? this.boards.boards.find(board => board.type === boardType)
            ?? this.boards.boards.find(board => board.name === boardName);
    }

    private findNodeIdByName(name: string): string {
        return this.dv.nodes.find(node => node.name === name)?.id ?? '';
    }

    private findDeviceIdByNodeAndPort(nodeName: string, port: string): string {
        return this.dv.nodes.find(node => node.name === nodeName)?.devices.find(device => (device.port || device.name) === port)?.id ?? '';
    }

    private defaultConnectionCoordinates(fromDeviceId: string, toDeviceId: string): number[] {
        const from = this.ui.entities[fromDeviceId]?.coordinates ?? [0, 0];
        const to = this.ui.entities[toDeviceId]?.coordinates ?? [0, 0];
        return [from[0], from[1], to[0], to[1]];
    }

    private flowRectToAbsoluteSc(x: number, y: number, w: number, h: number): number[] {
        return [
            Math.round(x * DV_SC_INV),
            Math.round(y * DV_SC_INV),
            Math.round((x + w) * DV_SC_INV),
            Math.round((y + h) * DV_SC_INV),
        ];
    }

    private flowPointToScopedSc(parentLayout: EntityLayout | undefined, x: number, y: number): { x: number; y: number } {
        const originX = parentLayout?.coordinates[0] ?? 0;
        const originY = parentLayout?.coordinates[1] ?? 0;
        return {
            x: originX + x * DV_SC_INV,
            y: originY + y * DV_SC_INV,
        };
    }

    private scRectWidth(coords: number[] | undefined): number {
        if (!coords || coords.length < 4) { return 0; }
        return coords[2] - coords[0];
    }

    private normalizeFunctionIdentity(value: string | undefined): string | undefined {
        const normalized = value?.trim().toLowerCase();
        if (!normalized) {
            return undefined;
        }
        return normalized.replace(/^\{/, '').replace(/\}$/, '');
    }
}