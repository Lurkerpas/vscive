import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { parseIvXml } from '../parsers/IvXmlParser';
import { parseUiXml, SC_SCALE } from '../parsers/UiXmlParser';
import { parseAttrXml, EMPTY_SCHEMA } from '../parsers/AttrXmlParser';
import { serializeIvXml } from '../serializers/IvXmlSerializer';
import { serializeUiXml } from '../serializers/UiXmlSerializer';
import {
    IvModel, UiModel, EntityLayout, AttributeSchema, FunctionModel, InterfaceModel,
    ConnectionModel, InterfaceKind, NodeMove, PropertyModel, ParameterModel,
} from '../model/types';
import { log } from '../logger';

const SC_INV = 1 / SC_SCALE; // pixels → SC coords (= 20)
const IFACE_W = 60;
const IFACE_H = 80;

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

    return { version: '1.0', entities };
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
        log(`InterfaceViewDocument.create: ${uri.fsPath}`);
        const doc = new InterfaceViewDocument(uri);
        await doc.reload();
        await doc.loadSchema();
        log(`InterfaceViewDocument.create done: ${doc.iv.functions.length} fn, ${doc.iv.connections.length} conn`);
        return doc;
    }

    async reload(): Promise<void> {
        log(`reload: reading ${this.uri.fsPath}`);
        const xmlBytes = await vscode.workspace.fs.readFile(this.uri);
        const xmlStr = Buffer.from(xmlBytes).toString('utf8');
        log(`reload: parsing IV XML (${xmlStr.length} bytes)`);
        this.iv = parseIvXml(xmlStr);
        log(`reload: IV parsed — uiFile=${this.iv.uiFile}`);

        if (!this.iv.uiFile) {
            // Legacy format: no separate UI file, coordinates are embedded as Taste::coordinates properties
            const baseName = path.basename(this.uri.fsPath, path.extname(this.uri.fsPath));
            this.iv.uiFile = `${baseName}_ui.xml`;
            this.ui = buildUiFromIv(this.iv);
            log(`reload: legacy format — extracted ${Object.keys(this.ui.entities).length} entities, generated uiFile=${this.iv.uiFile}`);
            return;
        }

        const uiPath = path.join(path.dirname(this.uri.fsPath), this.iv.uiFile);
        log(`reload: reading UI XML from ${uiPath}`);
        try {
            const uiBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(uiPath));
            this.ui = parseUiXml(Buffer.from(uiBytes).toString('utf8'));
            log(`reload: UI parsed — ${Object.keys(this.ui.entities).length} entities`);
        } catch (err) {
            log(`reload: UI XML not found or failed (${err}), using empty UI`);
            this.ui = { version: '1.0', entities: {} };
        }
    }

    async loadSchema(): Promise<void> {
        await this.loadSchemaFromPath('');
    }

    async loadSchemaFromPath(attrFilePath: string): Promise<void> {
        const cfgPath = attrFilePath
            || vscode.workspace.getConfiguration('vscive').get<string>('attributesFilePath')
            || path.join(process.env.HOME ?? '~', '.local', 'default_attributes.xml');
        log(`loadSchemaFromPath: trying ${cfgPath}`);
        try {
            const xml = fs.readFileSync(cfgPath, 'utf8');
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
                let absScX: number, absScY: number;
                if (move.parentId) {
                    const pl = this.ui.entities[move.parentId];
                    const originX = pl?.rootCoordinates?.[0] ?? pl?.coordinates[0] ?? 0;
                    const originY = pl?.rootCoordinates?.[1] ?? pl?.coordinates[1] ?? 0;
                    absScX = Math.round(originX + move.x * SC_INV);
                    absScY = Math.round(originY + move.y * SC_INV);
                } else {
                    absScX = Math.round(move.x * SC_INV);
                    absScY = Math.round(move.y * SC_INV);
                }
                const absScX2 = Math.round(absScX + move.w * SC_INV);
                const absScY2 = Math.round(absScY + move.h * SC_INV);

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
                const pl = this.ui.entities[move.parentId];
                const pX1 = pl?.rootCoordinates?.[0] ?? pl?.coordinates[0] ?? 0;
                const pY1 = pl?.rootCoordinates?.[1] ?? pl?.coordinates[1] ?? 0;
                const scX = Math.round(pX1 + (move.x + move.w / 2) * SC_INV);
                const scY = Math.round(pY1 + (move.y + move.h / 2) * SC_INV);
                this.ui.entities[move.id] = { coordinates: [scX, scY] };
            }
        }
    }

    addFunction(id: string, name: string, language: string, rfX: number, rfY: number, parentId?: string): void {
        const scX1 = Math.round(rfX * SC_INV);
        const scY1 = Math.round(rfY * SC_INV);
        const scX2 = scX1 + 800 * SC_INV; // 800px default width → 16000 SC units
        const scY2 = scY1 + 560 * SC_INV;

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
        this.ui.entities[id] = { coordinates: [scX1, scY1, scX2, scY2] };
    }

    addInterface(id: string, funcId: string, name: string, kind: InterfaceKind, ifaceType: 'provided' | 'required', relRfX: number, relRfY: number): void {
        const pl = this.ui.entities[funcId];
        const pX1 = pl?.coordinates[0] ?? 0;
        const pY1 = pl?.coordinates[1] ?? 0;
        // The relRf coords are the TOP-LEFT of the triangle; SC stores the center
        const scX = Math.round(pX1 + (relRfX + IFACE_W / 2) * SC_INV);
        const scY = Math.round(pY1 + (relRfY + IFACE_H / 2) * SC_INV);

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
        if (src.iface.type !== 'required' || tgt.iface.type !== 'provided') { return; }

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
            inheritPI: false,
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
        const riOriginX = riLayout?.rootCoordinates?.[0] ?? riLayout?.coordinates[0] ?? 0;
        const riOriginY = riLayout?.rootCoordinates?.[1] ?? riLayout?.coordinates[1] ?? 0;
        const piOriginX = piLayout?.rootCoordinates?.[0] ?? piLayout?.coordinates[0] ?? 0;
        const piOriginY = piLayout?.rootCoordinates?.[1] ?? piLayout?.coordinates[1] ?? 0;
        this.ui.entities[riId] = { coordinates: [
            Math.round(riOriginX + (riRelX + IFACE_W / 2) * SC_INV),
            Math.round(riOriginY + (riRelY + IFACE_H / 2) * SC_INV),
        ] };
        this.ui.entities[piId] = { coordinates: [
            Math.round(piOriginX + (piRelX + IFACE_W / 2) * SC_INV),
            Math.round(piOriginY + (piRelY + IFACE_H / 2) * SC_INV),
        ] };

        const connId = randomUUID();
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

    updateFunction(id: string, patch: { name?: string; language?: string; properties?: PropertyModel[]; extraAttrs?: Record<string, string> }): void {
        const fn = this.findFn(this.iv.functions, id);
        if (!fn) { return; }
        if (patch.name !== undefined) { fn.name = patch.name; }
        if (patch.language !== undefined) { fn.language = patch.language; }
        if (patch.properties !== undefined) { fn.properties = patch.properties; }
        if (patch.extraAttrs !== undefined) { fn.extraAttrs = { ...fn.extraAttrs, ...patch.extraAttrs }; }
    }

    updateInterface(id: string, patch: { name?: string; kind?: InterfaceKind; inheritPI?: boolean; parameters?: ParameterModel[]; extraAttrs?: Record<string, string> }): void {
        const result = this.findIface(id);
        if (!result) { return; }
        if (patch.name !== undefined) { result.iface.name = patch.name; }
        if (patch.kind !== undefined) { result.iface.kind = patch.kind; }
        if (patch.inheritPI !== undefined) { result.iface.inheritPI = patch.inheritPI; }
        if (patch.parameters !== undefined) { result.iface.parameters = patch.parameters; }
        if (patch.extraAttrs !== undefined) { result.iface.extraAttrs = { ...result.iface.extraAttrs, ...patch.extraAttrs }; }
    }

    connectToFunction(newIfaceId: string, connId: string, existingIfaceId: string, targetFuncId: string, relRfX: number, relRfY: number): void {
        const existingResult = this.findIface(existingIfaceId);
        const targetFn = this.findFn(this.iv.functions, targetFuncId);
        if (!existingResult || !targetFn) { return; }
        const { iface: existing } = existingResult;

        const newType: 'provided' | 'required' = existing.type === 'required' ? 'provided' : 'required';
        const newIface: InterfaceModel = {
            id: newIfaceId,
            name: existing.name,
            type: newType,
            kind: existing.kind,
            parameters: JSON.parse(JSON.stringify(existing.parameters)) as typeof existing.parameters,
            inheritPI: newType === 'required',
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
        const originX = targetLayout?.rootCoordinates?.[0] ?? targetLayout?.coordinates[0] ?? 0;
        const originY = targetLayout?.rootCoordinates?.[1] ?? targetLayout?.coordinates[1] ?? 0;
        this.ui.entities[newIfaceId] = { coordinates: [
            Math.round(originX + (relRfX + IFACE_W / 2) * SC_INV),
            Math.round(originY + (relRfY + IFACE_H / 2) * SC_INV),
        ] };

        const riId = newType === 'required' ? newIfaceId : existingIfaceId;
        const piId = newType === 'provided' ? newIfaceId : existingIfaceId;
        this.connect(connId, riId, piId);
    }

    // ── Private helpers ────────────────────────────────────────────────────

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

