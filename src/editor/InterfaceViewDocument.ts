import * as vscode from 'vscode';
import { parseIvXml } from '../parsers/IvXmlParser';
import { parseUiXml, SC_SCALE } from '../parsers/UiXmlParser';
import { parseAttrXml, EMPTY_SCHEMA } from '../parsers/AttrXmlParser';
import { serializeIvXml } from '../serializers/IvXmlSerializer';
import { serializeUiXml } from '../serializers/UiXmlSerializer';
import {
    IvModel, UiModel, EntityLayout, AttributeSchema, FunctionModel, InterfaceModel,
    ConnectionModel, ContextParameterModel, InterfaceKind, NodeMove, PropertyModel, ParameterModel,
    DEFAULT_FUNCTION_WIDTH, DEFAULT_FUNCTION_HEIGHT,
} from '../model/types';
import { log } from '../logger';
import {
    basenameWithoutExtension,
    createUuid,
    decodeUtf8,
    dirnameUri,
    joinPathSegments,
    parseStoredUriOrPath,
} from '../utils/platform';

const SC_INV = 1 / SC_SCALE; // pixels → SC coords (= 20)
const IFACE_W = 60;
const IFACE_H = 80;
const NEW_FUNCTION_DEFAULT_WIDTH = 1780;
const NEW_FUNCTION_DEFAULT_HEIGHT = 960;

interface Rect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/**
 * Legacy IV files embed coordinates as <Property name="Taste::coordinates"> on each entity
 * instead of using a separate UI XML file. Build a UiModel from those properties so the
 * rest of the code can treat legacy and modern files identically.
 */
function buildUiFromIv(iv: IvModel): UiModel {
    const entities: Record<string, EntityLayout> = {};

    function extract(id: string, properties: PropertyModel[]) {
        const p = properties.find(prop => prop.name === 'Taste::coordinates');
        if (p) {
            const coords = p.value.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
            if (coords.length > 0) { entities[id] = { coordinates: coords }; }
        }
    }

    function walkFn(fn: FunctionModel) {
        extract(fn.id, fn.properties);
        fn.providedInterfaces.forEach(iface => extract(iface.id, iface.properties));
        fn.requiredInterfaces.forEach(iface => extract(iface.id, iface.properties));
        fn.nestedFunctions.forEach(walkFn);
    }

    iv.functions.forEach(walkFn);

    // Also extract connection routing coordinates
    iv.connections.forEach(conn => extract(conn.id, conn.properties));

    const ui = { version: '1.0', entities };
    populateMissingRootCoordinates(iv, ui);
    return ui;
}

const ROOT_COORDINATES_MARGIN = 4000;

function isFunctionRect(coords: number[] | undefined): coords is [number, number, number, number] {
    return Array.isArray(coords) && coords.length >= 4;
}

function populateMissingRootCoordinates(iv: IvModel, ui: UiModel): void {
    const visit = (fn: FunctionModel) => {
        if (fn.nestedFunctions.length > 0) {
            const layout = ui.entities[fn.id] ?? { coordinates: [] };
            if (!isFunctionRect(layout.rootCoordinates)) {
                const childRects = fn.nestedFunctions
                    .map(child => ui.entities[child.id]?.coordinates)
                    .filter(isFunctionRect);

                if (childRects.length > 0) {
                    let minX = childRects[0][0];
                    let minY = childRects[0][1];
                    let maxX = childRects[0][2];
                    let maxY = childRects[0][3];

                    for (const coords of childRects.slice(1)) {
                        minX = Math.min(minX, coords[0]);
                        minY = Math.min(minY, coords[1]);
                        maxX = Math.max(maxX, coords[2]);
                        maxY = Math.max(maxY, coords[3]);
                    }

                    layout.rootCoordinates = [
                        minX - ROOT_COORDINATES_MARGIN,
                        minY - ROOT_COORDINATES_MARGIN,
                        maxX + ROOT_COORDINATES_MARGIN,
                        maxY + ROOT_COORDINATES_MARGIN,
                    ];
                    ui.entities[fn.id] = layout;
                }
            }
        }

        fn.nestedFunctions.forEach(visit);
    };

    iv.functions.forEach(visit);
}

export class InterfaceViewDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    iv!: IvModel;
    ui!: UiModel;
    schema: AttributeSchema = EMPTY_SCHEMA;

    private constructor(uri: vscode.Uri) {
        this.uri = uri;
    }

    static async create(uri: vscode.Uri): Promise<InterfaceViewDocument> {
        log(`InterfaceViewDocument.create: ${uri.toString()}`);
        const doc = new InterfaceViewDocument(uri);
        await doc.reload();
        await doc.loadSchema();
        log(`InterfaceViewDocument.create done: ${doc.iv.functions.length} fn, ${doc.iv.connections.length} conn`);
        return doc;
    }

    private async tryLoadUi(fileName: string): Promise<UiModel | undefined> {
        const uiUri = joinPathSegments(dirnameUri(this.uri), fileName);
        log(`reload: reading UI XML from ${uiUri.toString()}`);
        try {
            const uiBytes = await vscode.workspace.fs.readFile(uiUri);
            const ui = parseUiXml(decodeUtf8(uiBytes));
            populateMissingRootCoordinates(this.iv, ui);
            log(`reload: UI parsed from ${fileName} — ${Object.keys(ui.entities).length} entities`);
            return ui;
        } catch (err) {
            log(`reload: UI XML not found or failed for ${fileName} (${err})`);
            return undefined;
        }
    }

    async reload(): Promise<void> {
        log(`reload: reading ${this.uri.toString()}`);
        const xmlBytes = await vscode.workspace.fs.readFile(this.uri);
        const xmlStr = decodeUtf8(xmlBytes);
        log(`reload: parsing IV XML (${xmlStr.length} bytes)`);
        this.iv = parseIvXml(xmlStr);
        log(`reload: IV parsed — uiFile=${this.iv.uiFile}`);

        const baseName = basenameWithoutExtension(this.uri);
        const canonicalUiFile = `${baseName}.ui.xml`;
        const legacyUiFile = `${baseName}_ui.xml`;

        if (!this.iv.uiFile) {
            // Legacy format: no separate UI file, coordinates are embedded as Taste::coordinates properties
            this.iv.uiFile = canonicalUiFile;

            const existingUi = await this.tryLoadUi(canonicalUiFile)
                ?? await this.tryLoadUi(legacyUiFile);
            if (existingUi) {
                this.ui = existingUi;
                log(`reload: legacy format — migrated uiFile=${this.iv.uiFile}`);
                return;
            }

            this.ui = buildUiFromIv(this.iv);
            log(`reload: legacy format — extracted ${Object.keys(this.ui.entities).length} entities, generated uiFile=${this.iv.uiFile}`);
            return;
        }

        if (this.iv.uiFile === legacyUiFile) {
            this.iv.uiFile = canonicalUiFile;
            const migratedUi = await this.tryLoadUi(legacyUiFile)
                ?? await this.tryLoadUi(canonicalUiFile);
            if (migratedUi) {
                this.ui = migratedUi;
                log(`reload: normalized legacy uiFile to ${this.iv.uiFile}`);
                return;
            }

            log(`reload: no legacy UI XML found, using empty canonical UI ${this.iv.uiFile}`);
            this.ui = { version: '1.0', entities: {} };
            return;
        }

        this.ui = await this.tryLoadUi(this.iv.uiFile) ?? { version: '1.0', entities: {} };
    }

    async loadSchema(): Promise<void> {
        await this.loadSchemaFromPath('');
    }

    async loadSchemaFromPath(attrFilePath: string): Promise<void> {
        const cfgPath = attrFilePath
            || vscode.workspace.getConfiguration('vscive').get<string>('attributesFilePath')
            || (typeof process !== 'undefined' && typeof process.env?.HOME === 'string'
                ? `${process.env.HOME}/.local/default_attributes.xml`
                : '');
        const cfgUri = parseStoredUriOrPath(cfgPath);
        if (!cfgUri) {
            log('loadSchemaFromPath: no attributes file configured, using empty schema');
            this.schema = EMPTY_SCHEMA;
            return;
        }

        log(`loadSchemaFromPath: trying ${cfgUri.toString()}`);
        try {
            const xml = decodeUtf8(await vscode.workspace.fs.readFile(cfgUri));
            this.schema = parseAttrXml(xml);
            log('loadSchemaFromPath: schema loaded');
        } catch (err) {
            log(`loadSchemaFromPath: not found (${err}), using empty schema`);
            this.schema = EMPTY_SCHEMA;
        }
    }

    // ── Serialization ──────────────────────────────────────────────────────

    serializeToXml(): { ivXml: string; uiXml: string } {
        return {
            ivXml: serializeIvXml(this.iv),
            uiXml: serializeUiXml(this.ui),
        };
    }

    // ── Snapshot / Restore for undo-redo ──────────────────────────────────

    snapshot(): { iv: IvModel; ui: UiModel } {
        return {
            iv: JSON.parse(JSON.stringify(this.iv)) as IvModel,
            ui: JSON.parse(JSON.stringify(this.ui)) as UiModel,
        };
    }

    restore(snap: { iv: IvModel; ui: UiModel }): void {
        this.iv = JSON.parse(JSON.stringify(snap.iv)) as IvModel;
        this.ui = JSON.parse(JSON.stringify(snap.ui)) as UiModel;
    }

    // ── Mutations ──────────────────────────────────────────────────────────

    moveNodes(moves: NodeMove[]): void {
        for (const move of moves) {
            if (move.kind === 'function') {
                let nextCoords: number[];
                if (move.parentId) {
                    nextCoords = this.flowRectToScopedSc(this.ui.entities[move.parentId], move.x, move.y, move.w, move.h);
                } else {
                    nextCoords = this.flowRectToAbsoluteSc(move.x, move.y, move.w, move.h);
                }
                const [absScX, absScY, absScX2, absScY2] = nextCoords;

                // Compute delta to propagate to child interfaces and nested functions
                const oldLayout = this.ui.entities[move.id];
                const dX = oldLayout ? absScX - oldLayout.coordinates[0] : 0;
                const dY = oldLayout ? absScY - oldLayout.coordinates[1] : 0;

                // Preserve rootCoordinates and shift them by the same delta
                const oldRc = this.ui.entities[move.id]?.rootCoordinates;
                const newLayout: typeof this.ui.entities[string] = { coordinates: [absScX, absScY, absScX2, absScY2] };
                if (oldRc?.length === 4) {
                    newLayout.rootCoordinates = [
                        Math.round(oldRc[0] + dX), Math.round(oldRc[1] + dY),
                        Math.round(oldRc[2] + dX), Math.round(oldRc[3] + dY),
                    ];
                }
                this.ui.entities[move.id] = newLayout;

                if (dX !== 0 || dY !== 0) {
                    const fn = this.findFn(this.iv.functions, move.id);
                    if (fn) { this.shiftDescendants(fn, dX, dY); }
                }
            } else if (move.kind === 'interface' && move.parentId) {
                // Interface position is the SC absolute center of the pill
                const center = this.flowPointToScopedSc(
                    this.ui.entities[move.parentId],
                    move.x + move.w / 2,
                    move.y + move.h / 2,
                );
                const scX = Math.round(center.x);
                const scY = Math.round(center.y);
                this.ui.entities[move.id] = { coordinates: [scX, scY] };
            }
        }
    }

    addFunction(id: string, name: string, language: string, rfX: number, rfY: number, parentId?: string): void {
        const coords = parentId
            ? (() => {
                const parentRect = this.getFunctionFlowRect(parentId);
                if (!parentRect) {
                    return this.flowRectToAbsoluteSc(rfX, rfY, NEW_FUNCTION_DEFAULT_WIDTH, NEW_FUNCTION_DEFAULT_HEIGHT);
                }
                return this.flowRectToScopedSc(
                    this.ui.entities[parentId],
                    rfX - parentRect.x,
                    rfY - parentRect.y,
                    NEW_FUNCTION_DEFAULT_WIDTH,
                    NEW_FUNCTION_DEFAULT_HEIGHT,
                );
            })()
            : this.flowRectToAbsoluteSc(rfX, rfY, NEW_FUNCTION_DEFAULT_WIDTH, NEW_FUNCTION_DEFAULT_HEIGHT);

        const newFn: FunctionModel = {
            id,
            name,
            language,
            defaultImplementation: 'default',
            isType: false,
            fixedSystemElement: false,
            requiredSystemElement: false,
            providedInterfaces: [],
            requiredInterfaces: [],
            nestedFunctions: [],
            implementations: [{ name: 'default', language }],
            properties: [],
            extraAttrs: { startup_priority: '1', instances_min: '1', instances_max: '1' },
        };

        if (parentId) {
            const parent = this.findFn(this.iv.functions, parentId);
            if (parent) { parent.nestedFunctions.push(newFn); }
        } else {
            this.iv.functions.push(newFn);
        }
        this.ui.entities[id] = { coordinates: coords };
    }

    addInterface(id: string, funcId: string, name: string, kind: InterfaceKind, ifaceType: 'provided' | 'required', relRfX: number, relRfY: number): void {
        // The relRf coords are the TOP-LEFT of the triangle; SC stores the center
        const center = this.flowPointToScopedSc(
            this.ui.entities[funcId],
            relRfX + IFACE_W / 2,
            relRfY + IFACE_H / 2,
        );
        const scX = Math.round(center.x);
        const scY = Math.round(center.y);

        const newIface: InterfaceModel = {
            id,
            name,
            type: ifaceType,
            kind,
            parameters: [],
            inheritPI: false,
            autonamed: false,
            properties: [],
            extraAttrs: { layer: 'default', enable_multicast: 'true', required_system_element: 'NO' },
        };

        const fn = this.findFn(this.iv.functions, funcId);
        if (!fn) { return; }
        if (ifaceType === 'provided') {
            fn.providedInterfaces.push(newIface);
        } else {
            fn.requiredInterfaces.push(newIface);
        }
        this.ui.entities[id] = { coordinates: [scX, scY] };
    }

    connect(id: string, sourceIfaceId: string, targetIfaceId: string): void {
        const src = this.findIface(sourceIfaceId);
        const tgt = this.findIface(targetIfaceId);
        if (!src || !tgt) { return; }
        const isStandardConnection = src.iface.type === 'required' && tgt.iface.type === 'provided';
        const isProxyConnection = src.iface.type === tgt.iface.type
            && this.areFunctionsInProxyRelation(src.func.id, tgt.func.id);
        if (!isStandardConnection && !isProxyConnection) { return; }

        if (isStandardConnection) {
            this.syncRequiredInterfaceFromSource(src.iface, tgt.iface);
        }

        const conn: ConnectionModel = {
            id,
            name: `${src.iface.name}_to_${tgt.iface.name}`,
            sourceIfaceId,
            sourceFuncName: src.func.name,
            sourceRiName: src.iface.name,
            targetIfaceId,
            targetFuncName: tgt.func.name,
            targetPiName: tgt.iface.name,
            properties: [],
            extraAttrs: {},
        };
        this.iv.connections.push(conn);
    }

    /**
     * Create a matched RI on riFuncId and PI on piFuncId, then connect them.
     * Used when the user Ctrl+drags between two functions.
     */
    connectFunctions(riId: string, piId: string, riFuncId: string, piFuncId: string, riRelX: number, riRelY: number, piRelX: number, piRelY: number): void {
        const riFn = this.findFn(this.iv.functions, riFuncId);
        const piFn = this.findFn(this.iv.functions, piFuncId);
        if (!riFn || !piFn) { return; }

        const ifaceName = `${riFn.name}_to_${piFn.name}`;

        const riIface: InterfaceModel = {
            id: riId,
            name: ifaceName,
            type: 'required',
            kind: 'Sporadic',
            parameters: [],
            inheritPI: true,
            autonamed: true,
            properties: [],
            extraAttrs: { layer: 'default', enable_multicast: 'true', required_system_element: 'NO' },
        };
        const piIface: InterfaceModel = {
            id: piId,
            name: ifaceName,
            type: 'provided',
            kind: 'Sporadic',
            parameters: [],
            inheritPI: false,
            autonamed: true,
            properties: [],
            extraAttrs: { layer: 'default', enable_multicast: 'true', required_system_element: 'NO' },
        };

        riFn.requiredInterfaces.push(riIface);
        piFn.providedInterfaces.push(piIface);

        // Place interfaces at the clicked border positions (riRelX/Y, piRelX/Y are top-left of
        // IFACE_W×IFACE_H box in flow-pixel coords relative to the host function's top-left)
        const riLayout = this.ui.entities[riFuncId];
        const piLayout = this.ui.entities[piFuncId];
        const riCenter = this.flowPointToScopedSc(riLayout, riRelX + IFACE_W / 2, riRelY + IFACE_H / 2);
        const piCenter = this.flowPointToScopedSc(piLayout, piRelX + IFACE_W / 2, piRelY + IFACE_H / 2);
        this.ui.entities[riId] = { coordinates: [
            Math.round(riCenter.x),
            Math.round(riCenter.y),
        ] };
        this.ui.entities[piId] = { coordinates: [
            Math.round(piCenter.x),
            Math.round(piCenter.y),
        ] };

        const connId = createUuid();
        this.connect(connId, riId, piId);
    }

    deleteEntities(ids: string[]): void {
        const toRemove = new Set(ids);

        // Expand: if a function is deleted, also delete all its descendants
        const collectDescendants = (fn: FunctionModel) => {
            toRemove.add(fn.id);
            for (const iface of [...fn.providedInterfaces, ...fn.requiredInterfaces]) {
                toRemove.add(iface.id);
            }
            for (const child of fn.nestedFunctions) { collectDescendants(child); }
        };
        for (const id of [...ids]) {
            const fn = this.findFn(this.iv.functions, id);
            if (fn) { collectDescendants(fn); }
        }

        // Remove functions (and nested) from tree
        const pruneFunctions = (fns: FunctionModel[]): FunctionModel[] =>
            fns
                .filter(fn => !toRemove.has(fn.id))
                .map(fn => ({
                    ...fn,
                    providedInterfaces: fn.providedInterfaces.filter(i => !toRemove.has(i.id)),
                    requiredInterfaces: fn.requiredInterfaces.filter(i => !toRemove.has(i.id)),
                    nestedFunctions: pruneFunctions(fn.nestedFunctions),
                }));

        this.iv.functions = pruneFunctions(this.iv.functions);

        // Remove connections that reference deleted entities
        this.iv.connections = this.iv.connections.filter(c =>
            !toRemove.has(c.id) &&
            !toRemove.has(c.sourceIfaceId) &&
            !toRemove.has(c.targetIfaceId),
        );

        // Remove UI layouts
        for (const id of toRemove) { delete this.ui.entities[id]; }
    }

    updateFunction(id: string, patch: { name?: string; language?: string; defaultImplementation?: string; isType?: boolean; fixedSystemElement?: boolean; contextParameters?: ContextParameterModel[]; properties?: PropertyModel[]; extraAttrs?: Record<string, string> }): void {
        const fn = this.findFn(this.iv.functions, id);
        if (!fn) { return; }
        if (patch.name !== undefined) {
            const oldName = fn.name;
            fn.name = patch.name;
            // Propagate to connection endpoint name fields (REQ-0050)
            for (const conn of this.iv.connections) {
                if (conn.sourceFuncName === oldName) { conn.sourceFuncName = patch.name; }
                if (conn.targetFuncName === oldName) { conn.targetFuncName = patch.name; }
            }
        }
        if (patch.language !== undefined) { fn.language = patch.language; }
        if (patch.defaultImplementation !== undefined) { fn.defaultImplementation = patch.defaultImplementation; }
        if (patch.isType !== undefined) { fn.isType = patch.isType; }
        if (patch.fixedSystemElement !== undefined) { fn.fixedSystemElement = patch.fixedSystemElement; }
        if (patch.contextParameters !== undefined) { fn.contextParameters = patch.contextParameters; }
        if (patch.properties !== undefined) { fn.properties = patch.properties; }
        if (patch.extraAttrs !== undefined) {
            fn.extraAttrs = { ...fn.extraAttrs, ...patch.extraAttrs };
            // Keep typed boolean fields in sync when changed via schema extraAttrs
            if (patch.extraAttrs.is_type !== undefined) { fn.isType = patch.extraAttrs.is_type.toUpperCase() === 'YES'; }
            if (patch.extraAttrs.fixed_system_element !== undefined) { fn.fixedSystemElement = patch.extraAttrs.fixed_system_element.toUpperCase() === 'YES'; }
        }
    }

    updateInterface(id: string, patch: { name?: string; kind?: InterfaceKind; inheritPI?: boolean; parameters?: ParameterModel[]; extraAttrs?: Record<string, string> }): void {
        const result = this.findIface(id);
        if (!result) { return; }
        if (patch.name !== undefined) {
            const oldName = result.iface.name;
            result.iface.name = patch.name;
            // Propagate to connection endpoint name fields (REQ-0050)
            for (const conn of this.iv.connections) {
                let changed = false;
                if (conn.sourceIfaceId === id && conn.sourceRiName === oldName) {
                    conn.sourceRiName = patch.name;
                    changed = true;
                }
                if (conn.targetIfaceId === id && conn.targetPiName === oldName) {
                    conn.targetPiName = patch.name;
                    changed = true;
                }
                if (changed) {
                    conn.name = `${conn.sourceRiName}_to_${conn.targetPiName}`;
                }
            }
        }
        if (patch.kind !== undefined) { result.iface.kind = patch.kind; }
        if (patch.inheritPI !== undefined) { result.iface.inheritPI = patch.inheritPI; }
        if (patch.parameters !== undefined) { result.iface.parameters = patch.parameters; }
        if (patch.extraAttrs !== undefined) { result.iface.extraAttrs = { ...result.iface.extraAttrs, ...patch.extraAttrs }; }
        if (result.iface.type === 'provided') {
            this.syncConnectedRequiredInterfaces(result.iface.id);
        }
    }

    connectToFunction(newIfaceId: string, connId: string, existingIfaceId: string, targetFuncId: string, relRfX: number, relRfY: number): void {
        const existingResult = this.findIface(existingIfaceId);
        const targetFn = this.findFn(this.iv.functions, targetFuncId);
        if (!existingResult || !targetFn) { return; }
        const { iface: existing } = existingResult;

        const keepSameType = this.areFunctionsInProxyRelation(existingResult.func.id, targetFuncId);
        const newType: 'provided' | 'required' = keepSameType
            ? existing.type
            : existing.type === 'required' ? 'provided' : 'required';
        const newIface: InterfaceModel = {
            id: newIfaceId,
            name: existing.name,
            type: newType,
            kind: existing.kind,
            parameters: JSON.parse(JSON.stringify(existing.parameters)) as typeof existing.parameters,
            inheritPI: keepSameType ? existing.inheritPI : newType === 'required',
            autonamed: true,
            properties: [],
            extraAttrs: { layer: 'default', enable_multicast: 'true', required_system_element: 'NO' },
        };

        if (newType === 'provided') {
            targetFn.providedInterfaces.push(newIface);
        } else {
            targetFn.requiredInterfaces.push(newIface);
        }

        const targetLayout = this.ui.entities[targetFuncId];
        const center = this.flowPointToScopedSc(targetLayout, relRfX + IFACE_W / 2, relRfY + IFACE_H / 2);
        this.ui.entities[newIfaceId] = { coordinates: [
            Math.round(center.x),
            Math.round(center.y),
        ] };

        if (keepSameType) {
            this.connect(connId, existingIfaceId, newIfaceId);
        } else {
            const riId = newType === 'required' ? newIfaceId : existingIfaceId;
            const piId = newType === 'provided' ? newIfaceId : existingIfaceId;
            this.connect(connId, riId, piId);
        }
    }

    /**
     * Paste a function as a copy of `source` — new IDs, no connections, no nested functions.
     * `rfX`, `rfY` are the flow-pixel (React Flow) top-left position for the pasted node.
     */
    pasteFunction(newId: string, source: FunctionModel, rfX: number, rfY: number): void {
        const coords = this.flowRectToAbsoluteSc(rfX, rfY, DEFAULT_FUNCTION_WIDTH, DEFAULT_FUNCTION_HEIGHT);

        const newFn: FunctionModel = {
            ...(JSON.parse(JSON.stringify(source)) as FunctionModel),
            id: newId,
            nestedFunctions: [],
            providedInterfaces: source.providedInterfaces.map(iface => ({
                ...(JSON.parse(JSON.stringify(iface)) as InterfaceModel),
                id: createUuid(),
            })),
            requiredInterfaces: source.requiredInterfaces.map(iface => ({
                ...(JSON.parse(JSON.stringify(iface)) as InterfaceModel),
                id: createUuid(),
            })),
        };

        this.iv.functions.push(newFn);
        this.ui.entities[newId] = { coordinates: coords };
        // Interface positions are omitted; buildGraph falls back to stacking on left/right edges.
    }

    /**
     * Paste an interface as a copy of `source` onto function `funcId` — new ID, no connections.
     * `relRfX`, `relRfY` are the top-left of the IFACE_W×IFACE_H box relative to the function's top-left.
     */
    pasteInterface(newId: string, source: InterfaceModel, funcId: string, relRfX: number, relRfY: number): void {
        const fn = this.findFn(this.iv.functions, funcId);
        if (!fn) { return; }

        const center = this.flowPointToScopedSc(
            this.ui.entities[funcId],
            relRfX + IFACE_W / 2,
            relRfY + IFACE_H / 2,
        );
        const scX = Math.round(center.x);
        const scY = Math.round(center.y);

        const newIface: InterfaceModel = {
            ...(JSON.parse(JSON.stringify(source)) as InterfaceModel),
            id: newId,
        };

        if (source.type === 'provided') {
            fn.providedInterfaces.push(newIface);
        } else {
            fn.requiredInterfaces.push(newIface);
        }
        this.ui.entities[newId] = { coordinates: [scX, scY] };
    }

    /**
     * Move function `id` to a new parent (or to root if `newParentId` is undefined).
     * SC coordinates are already absolute and do not need updating.
     */
    reparentFunction(id: string, newParentId?: string): void {
        const currentFlowRect = this.getFunctionFlowRect(id);
        const fn = this.removeFnFromTree(id);
        if (!fn) { return; }
        if (newParentId) {
            const parent = this.findFn(this.iv.functions, newParentId);
            if (parent) { parent.nestedFunctions.push(fn); }
            else { this.iv.functions.push(fn); } // fallback: root
        } else {
            this.iv.functions.push(fn);
        }

        if (!currentFlowRect) { return; }

        if (newParentId) {
            const parentFlowRect = this.getFunctionFlowRect(newParentId);
            if (!parentFlowRect) { return; }
            this.ui.entities[id] = {
                ...(this.ui.entities[id] ?? { coordinates: [] }),
                coordinates: this.flowRectToScopedSc(
                    this.ui.entities[newParentId],
                    currentFlowRect.x - parentFlowRect.x,
                    currentFlowRect.y - parentFlowRect.y,
                    currentFlowRect.w,
                    currentFlowRect.h,
                ),
            };
        } else {
            this.ui.entities[id] = {
                ...(this.ui.entities[id] ?? { coordinates: [] }),
                coordinates: this.flowRectToAbsoluteSc(
                    currentFlowRect.x,
                    currentFlowRect.y,
                    currentFlowRect.w,
                    currentFlowRect.h,
                ),
            };
        }
    }

    /** Store connection waypoints (in RF pixels) in the UiModel as SC units. */
    updateConnectionWaypoints(id: string, waypoints: Array<{x: number; y: number}>): void {
        if (waypoints.length > 0) {
            const conn = this.iv.connections.find(item => item.id === id);
            const containerId = conn ? this.findConnectionContainerId(conn) : undefined;
            const containerLayout = containerId ? this.ui.entities[containerId] : undefined;
            const containerRect = containerId ? this.getFunctionFlowRect(containerId) : undefined;
            const coords: number[] = [];
            for (const wp of waypoints) {
                if (containerLayout?.rootCoordinates?.length === 4 && containerRect) {
                    const scoped = this.flowPointToScopedSc(
                        containerLayout,
                        wp.x - containerRect.x,
                        wp.y - containerRect.y,
                    );
                    coords.push(Math.round(scoped.x));
                    coords.push(Math.round(scoped.y));
                } else {
                    coords.push(Math.round(wp.x * SC_INV));
                    coords.push(Math.round(wp.y * SC_INV));
                }
            }
            this.ui.entities[id] = { coordinates: coords };
        } else {
            delete this.ui.entities[id];
        }
    }

    // ── Private helpers ────────────────────────────────────────────────────

    private removeFnFromTree(id: string): FunctionModel | undefined {
        const rootIdx = this.iv.functions.findIndex(fn => fn.id === id);
        if (rootIdx !== -1) {
            return this.iv.functions.splice(rootIdx, 1)[0];
        }
        return this.removeFnFromNested(this.iv.functions, id);
    }

    private removeFnFromNested(fns: FunctionModel[], id: string): FunctionModel | undefined {
        for (const fn of fns) {
            const idx = fn.nestedFunctions.findIndex(c => c.id === id);
            if (idx !== -1) {
                return fn.nestedFunctions.splice(idx, 1)[0];
            }
            const found = this.removeFnFromNested(fn.nestedFunctions, id);
            if (found) { return found; }
        }
        return undefined;
    }

    private findFn(fns: FunctionModel[], id: string): FunctionModel | undefined {
        for (const fn of fns) {
            if (fn.id === id) { return fn; }
            const found = this.findFn(fn.nestedFunctions, id);
            if (found) { return found; }
        }
        return undefined;
    }

    private findIface(ifaceId: string): { func: FunctionModel; iface: InterfaceModel } | undefined {
        const search = (fns: FunctionModel[]): { func: FunctionModel; iface: InterfaceModel } | undefined => {
            for (const fn of fns) {
                for (const iface of [...fn.providedInterfaces, ...fn.requiredInterfaces]) {
                    if (iface.id === ifaceId) { return { func: fn, iface }; }
                }
                const found = search(fn.nestedFunctions);
                if (found) { return found; }
            }
            return undefined;
        };
        return search(this.iv.functions);
    }

    private rectFromCoords(coords: number[] | undefined): Rect | undefined {
        if (!coords || coords.length < 4) { return undefined; }
        return { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] };
    }

    private flowRectToAbsoluteSc(x: number, y: number, w: number, h: number): number[] {
        return [
            Math.round(x * SC_INV),
            Math.round(y * SC_INV),
            Math.round((x + w) * SC_INV),
            Math.round((y + h) * SC_INV),
        ];
    }

    private flowRectToScopedSc(parentLayout: EntityLayout | undefined, x: number, y: number, w: number, h: number): number[] {
        const topLeft = this.flowPointToScopedSc(parentLayout, x, y);
        const bottomRight = this.flowPointToScopedSc(parentLayout, x + w, y + h);
        return [
            Math.round(topLeft.x),
            Math.round(topLeft.y),
            Math.round(bottomRight.x),
            Math.round(bottomRight.y),
        ];
    }

    private flowPointToScopedSc(parentLayout: EntityLayout | undefined, x: number, y: number): { x: number; y: number } {
        const outer = this.rectFromCoords(parentLayout?.coordinates);
        const inner = this.rectFromCoords(parentLayout?.rootCoordinates);

        if (outer && inner) {
            const widthPx = Math.max((outer.x2 - outer.x1) * SC_SCALE, 1);
            const heightPx = Math.max((outer.y2 - outer.y1) * SC_SCALE, 1);
            return {
                x: inner.x1 + (x / widthPx) * (inner.x2 - inner.x1),
                y: inner.y1 + (y / heightPx) * (inner.y2 - inner.y1),
            };
        }

        const originX = parentLayout?.coordinates[0] ?? 0;
        const originY = parentLayout?.coordinates[1] ?? 0;
        return {
            x: originX + x * SC_INV,
            y: originY + y * SC_INV,
        };
    }

    private scopedScRectToFlow(parentLayout: EntityLayout | undefined, coords: number[] | undefined): { x: number; y: number; w: number; h: number } | undefined {
        const rect = this.rectFromCoords(coords);
        if (!rect) { return undefined; }

        const topLeft = this.scopedScPointToFlow(parentLayout, rect.x1, rect.y1);
        const bottomRight = this.scopedScPointToFlow(parentLayout, rect.x2, rect.y2);
        return {
            x: topLeft.x,
            y: topLeft.y,
            w: Math.max(bottomRight.x - topLeft.x, 1),
            h: Math.max(bottomRight.y - topLeft.y, 1),
        };
    }

    private scopedScPointToFlow(parentLayout: EntityLayout | undefined, scX: number, scY: number): { x: number; y: number } {
        const outer = this.rectFromCoords(parentLayout?.coordinates);
        const inner = this.rectFromCoords(parentLayout?.rootCoordinates);

        if (outer && inner) {
            const widthPx = Math.max((outer.x2 - outer.x1) * SC_SCALE, 1);
            const heightPx = Math.max((outer.y2 - outer.y1) * SC_SCALE, 1);
            return {
                x: ((scX - inner.x1) / (inner.x2 - inner.x1 || 1)) * widthPx,
                y: ((scY - inner.y1) / (inner.y2 - inner.y1 || 1)) * heightPx,
            };
        }

        const originX = parentLayout?.coordinates[0] ?? 0;
        const originY = parentLayout?.coordinates[1] ?? 0;
        return {
            x: (scX - originX) * SC_SCALE,
            y: (scY - originY) * SC_SCALE,
        };
    }

    private findFnWithParent(fns: FunctionModel[], id: string, parentId?: string): { fn: FunctionModel; parentId?: string } | undefined {
        for (const fn of fns) {
            if (fn.id === id) {
                return { fn, parentId };
            }
            const nested = this.findFnWithParent(fn.nestedFunctions, id, fn.id);
            if (nested) { return nested; }
        }
        return undefined;
    }

    private getFunctionFlowRect(id: string): { x: number; y: number; w: number; h: number } | undefined {
        const entry = this.findFnWithParent(this.iv.functions, id);
        if (!entry) { return undefined; }

        const layout = this.ui.entities[id];
        const ownRect = this.rectFromCoords(layout?.coordinates);
        if (!ownRect) { return undefined; }

        if (!entry.parentId) {
            return {
                x: ownRect.x1 * SC_SCALE,
                y: ownRect.y1 * SC_SCALE,
                w: Math.max((ownRect.x2 - ownRect.x1) * SC_SCALE, 1),
                h: Math.max((ownRect.y2 - ownRect.y1) * SC_SCALE, 1),
            };
        }

        const parentRect = this.getFunctionFlowRect(entry.parentId);
        if (!parentRect) { return undefined; }

        const localRect = this.scopedScRectToFlow(this.ui.entities[entry.parentId], layout?.coordinates);
        if (!localRect) { return undefined; }

        return {
            x: parentRect.x + localRect.x,
            y: parentRect.y + localRect.y,
            w: localRect.w,
            h: localRect.h,
        };
    }

    private findFunctionParentId(id: string): string | undefined {
        return this.findFnWithParent(this.iv.functions, id)?.parentId;
    }

    private isAncestorFunction(ancestorId: string, descendantId: string): boolean {
        let current: string | undefined = descendantId;
        while (current) {
            if (current === ancestorId) { return true; }
            current = this.findFunctionParentId(current);
        }
        return false;
    }

    private areFunctionsInProxyRelation(leftFuncId: string, rightFuncId: string): boolean {
        return leftFuncId !== rightFuncId
            && (this.isAncestorFunction(leftFuncId, rightFuncId) || this.isAncestorFunction(rightFuncId, leftFuncId));
    }

    private findConnectionContainerId(conn: ConnectionModel): string | undefined {
        const sourceFuncId = this.findIface(conn.sourceIfaceId)?.func.id;
        const targetFuncId = this.findIface(conn.targetIfaceId)?.func.id;
        if (!sourceFuncId || !targetFuncId) { return undefined; }

        const sourceAncestors = new Set<string>();
        let current: string | undefined = sourceFuncId;
        while (current) {
            sourceAncestors.add(current);
            current = this.findFunctionParentId(current);
        }

        current = targetFuncId;
        while (current) {
            if (sourceAncestors.has(current)) {
                return current;
            }
            current = this.findFunctionParentId(current);
        }

        return undefined;
    }

    private syncConnectedRequiredInterfaces(providedIfaceId: string): void {
        const provided = this.findIface(providedIfaceId);
        if (!provided || provided.iface.type !== 'provided') { return; }

        const queue: string[] = [];
        const visited = new Set<string>();

        for (const conn of this.iv.connections) {
            if (conn.targetIfaceId !== providedIfaceId) { continue; }
            const required = this.findIface(conn.sourceIfaceId);
            if (!required || required.iface.type !== 'required') { continue; }
            this.syncRequiredInterfaceFromSource(required.iface, provided.iface);
            this.refreshConnectionNames(conn);
            if (!visited.has(required.iface.id)) {
                visited.add(required.iface.id);
                queue.push(required.iface.id);
            }
        }

        while (queue.length > 0) {
            const sourceRequiredId = queue.shift()!;
            const sourceRequired = this.findIface(sourceRequiredId);
            if (!sourceRequired || sourceRequired.iface.type !== 'required') { continue; }

            for (const conn of this.iv.connections) {
                let candidateRequiredId: string | undefined;
                if (conn.sourceIfaceId === sourceRequiredId) {
                    candidateRequiredId = conn.targetIfaceId;
                } else if (conn.targetIfaceId === sourceRequiredId) {
                    candidateRequiredId = conn.sourceIfaceId;
                } else {
                    continue;
                }

                const candidateRequired = this.findIface(candidateRequiredId);
                if (!candidateRequired || candidateRequired.iface.type !== 'required') { continue; }
                if (!this.areFunctionsInProxyRelation(sourceRequired.func.id, candidateRequired.func.id)) { continue; }

                this.syncRequiredInterfaceFromSource(candidateRequired.iface, sourceRequired.iface);
                this.refreshConnectionNames(conn);

                if (!visited.has(candidateRequired.iface.id)) {
                    visited.add(candidateRequired.iface.id);
                    queue.push(candidateRequired.iface.id);
                }
            }
        }
    }

    private syncRequiredInterfaceFromSource(requiredIface: InterfaceModel, sourceIface: InterfaceModel): void {
        const shouldRename = requiredIface.autonamed || requiredIface.name.trim() === '';
        const shouldCopyParams = requiredIface.inheritPI || requiredIface.parameters.length === 0;

        requiredIface.inheritPI = true;
        requiredIface.kind = sourceIface.kind;

        if (shouldRename) {
            requiredIface.name = sourceIface.name;
        }
        if (shouldCopyParams) {
            requiredIface.parameters = JSON.parse(JSON.stringify(sourceIface.parameters)) as ParameterModel[];
        }

        const requiredPropNames = new Set(requiredIface.properties.map(prop => prop.name));
        for (const prop of sourceIface.properties) {
            if (!requiredPropNames.has(prop.name)) {
                requiredIface.properties.push(JSON.parse(JSON.stringify(prop)) as PropertyModel);
            }
        }

        for (const [name, value] of Object.entries(sourceIface.extraAttrs)) {
            if (!(name in requiredIface.extraAttrs) || requiredIface.extraAttrs[name] === '') {
                requiredIface.extraAttrs[name] = value;
            }
        }
    }

    private refreshConnectionNames(conn: ConnectionModel): void {
        const source = this.findIface(conn.sourceIfaceId);
        const target = this.findIface(conn.targetIfaceId);
        if (source) {
            conn.sourceRiName = source.iface.name;
        }
        if (target) {
            conn.targetPiName = target.iface.name;
        }
        conn.name = `${conn.sourceRiName}_to_${conn.targetPiName}`;
    }

    /** Shift all SC coordinates of a function's interfaces and nested children by (dX, dY). */
    private shiftDescendants(fn: FunctionModel, dX: number, dY: number): void {
        for (const iface of [...fn.providedInterfaces, ...fn.requiredInterfaces]) {
            const l = this.ui.entities[iface.id];
            if (l?.coordinates.length >= 2) {
                l.coordinates = [Math.round(l.coordinates[0] + dX), Math.round(l.coordinates[1] + dY)];
            }
        }
        for (const child of fn.nestedFunctions) {
            const l = this.ui.entities[child.id];
            if (l?.coordinates.length >= 4) {
                l.coordinates = [Math.round(l.coordinates[0] + dX), Math.round(l.coordinates[1] + dY),
                    Math.round(l.coordinates[2] + dX), Math.round(l.coordinates[3] + dY)];
            }
            if (l?.rootCoordinates?.length === 4) {
                l.rootCoordinates = [Math.round(l.rootCoordinates[0] + dX), Math.round(l.rootCoordinates[1] + dY),
                    Math.round(l.rootCoordinates[2] + dX), Math.round(l.rootCoordinates[3] + dY)];
            }
            this.shiftDescendants(child, dX, dY);
        }
    }

    dispose(): void {
        // nothing to dispose for MVP
    }
}

