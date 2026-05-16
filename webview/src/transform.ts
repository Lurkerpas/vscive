import type { Node, Edge } from '@xyflow/react';
import {
    IvModel, UiModel, FunctionModel, InterfaceModel, ConnectionModel, EntityLayout,
    DEFAULT_FUNCTION_WIDTH, DEFAULT_FUNCTION_HEIGHT,
} from '../../src/model/types';
import { functionContentRect } from './functionLayout';
import { makeWaypointNodeId, WAYPOINT_NODE_SIZE, waypointNodeSize } from './waypoints';

const SC_SCALE = 0.05;

function px(v: number): number { return v * SC_SCALE; }

interface Rect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

interface FunctionMaps {
    parentByFunction: Map<string, string | undefined>;
    functionByInterface: Map<string, string>;
}

function layoutOf(ui: UiModel, id: string): EntityLayout | undefined {
    return ui.entities[id];
}

function rectFromCoords(coords: number[] | undefined): Rect | null {
    if (!coords || coords.length < 4) { return null; }
    return { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] };
}

function rectWidth(rect: Rect): number {
    return rect.x2 - rect.x1;
}

function rectHeight(rect: Rect): number {
    return rect.y2 - rect.y1;
}

function scaleInto(value: number, srcStart: number, srcEnd: number, dstSpan: number): number {
    const srcSpan = srcEnd - srcStart;
    if (Math.abs(srcSpan) < 1e-9) { return 0; }
    return ((value - srcStart) / srcSpan) * dstSpan;
}

function localScaleFactor(parentLayout: EntityLayout | undefined): number {
    const outer = rectFromCoords(parentLayout?.coordinates);
    const inner = rectFromCoords(parentLayout?.rootCoordinates);

    if (!outer || !inner) {
        return 1;
    }

    const scaleX = Math.abs(rectWidth(outer) / (rectWidth(inner) || 1));
    const scaleY = Math.abs(rectHeight(outer) / (rectHeight(inner) || 1));
    return Math.max(Math.min(scaleX, scaleY), 0.05);
}

function mapPointToParentLocalPx(
    parentLayout: EntityLayout | undefined,
    scX: number,
    scY: number,
): { x: number; y: number } {
    const outer = rectFromCoords(parentLayout?.coordinates);
    const inner = rectFromCoords(parentLayout?.rootCoordinates);

    if (outer && inner) {
        const widthPx = Math.max(px(rectWidth(outer)), 1);
        const heightPx = Math.max(px(rectHeight(outer)), 1);
        return {
            x: scaleInto(scX, inner.x1, inner.x2, widthPx),
            y: scaleInto(scY, inner.y1, inner.y2, heightPx),
        };
    }

    const originX = parentLayout?.coordinates[0] ?? 0;
    const originY = parentLayout?.coordinates[1] ?? 0;
    return {
        x: px(scX - originX),
        y: px(scY - originY),
    };
}

function mapPointToParentContentLocalPx(
    parentLayout: EntityLayout | undefined,
    scX: number,
    scY: number,
    parentFontScale = 1,
): { x: number; y: number } {
    const outer = rectFromCoords(parentLayout?.coordinates);
    const inner = rectFromCoords(parentLayout?.rootCoordinates);

    if (outer && inner) {
        const widthPx = Math.max(px(rectWidth(outer)), 1);
        const heightPx = Math.max(px(rectHeight(outer)), 1);
        const content = functionContentRect(widthPx, heightPx, parentFontScale);
        return {
            x: scaleInto(scX, inner.x1, inner.x2, content.width),
            y: content.y + scaleInto(scY, inner.y1, inner.y2, content.height),
        };
    }

    return mapPointToParentLocalPx(parentLayout, scX, scY);
}

function mapRectToParentLocalPx(
    parentLayout: EntityLayout | undefined,
    coords: number[] | undefined,
    parentFontScale = 1,
): { x: number; y: number; w: number; h: number } | null {
    const rect = rectFromCoords(coords);
    if (!rect) { return null; }

    const outer = rectFromCoords(parentLayout?.coordinates);
    const inner = rectFromCoords(parentLayout?.rootCoordinates);

    if (outer && inner) {
        const widthPx = Math.max(px(rectWidth(outer)), 1);
        const heightPx = Math.max(px(rectHeight(outer)), 1);
        const content = functionContentRect(widthPx, heightPx, parentFontScale);
        const left = scaleInto(rect.x1, inner.x1, inner.x2, content.width);
        const right = scaleInto(rect.x2, inner.x1, inner.x2, content.width);
        const top = scaleInto(rect.y1, inner.y1, inner.y2, content.height);
        const bottom = scaleInto(rect.y2, inner.y1, inner.y2, content.height);
        return {
            x: left,
            y: content.y + top,
            w: Math.max(right - left, 1),
            h: Math.max(bottom - top, 1),
        };
    }

    const topLeft = mapPointToParentLocalPx(parentLayout, rect.x1, rect.y1);
    const bottomRight = mapPointToParentLocalPx(parentLayout, rect.x2, rect.y2);
    return {
        x: topLeft.x,
        y: topLeft.y,
        w: Math.max(bottomRight.x - topLeft.x, 1),
        h: Math.max(bottomRight.y - topLeft.y, 1),
    };
}

function buildFunctionMaps(
    functions: FunctionModel[],
    parentId?: string,
    maps: FunctionMaps = {
        parentByFunction: new Map<string, string | undefined>(),
        functionByInterface: new Map<string, string>(),
    },
): FunctionMaps {
    for (const fn of functions) {
        maps.parentByFunction.set(fn.id, parentId);
        for (const iface of [...fn.providedInterfaces, ...fn.requiredInterfaces]) {
            maps.functionByInterface.set(iface.id, fn.id);
        }
        buildFunctionMaps(fn.nestedFunctions, fn.id, maps);
    }
    return maps;
}

function findCommonAncestorFunction(
    leftId: string | undefined,
    rightId: string | undefined,
    parentByFunction: Map<string, string | undefined>,
): string | undefined {
    if (!leftId || !rightId) { return undefined; }

    const ancestors = new Set<string>();
    let current: string | undefined = leftId;
    while (current) {
        ancestors.add(current);
        current = parentByFunction.get(current);
    }

    current = rightId;
    while (current) {
        if (ancestors.has(current)) { return current; }
        current = parentByFunction.get(current);
    }

    return undefined;
}

function absoluteNodePosition(nodeId: string, nodeMap: Map<string, Node>, cache: Map<string, { x: number; y: number }>): { x: number; y: number } {
    const cached = cache.get(nodeId);
    if (cached) { return cached; }

    const node = nodeMap.get(nodeId);
    if (!node) {
        return { x: 0, y: 0 };
    }

    const absolute = node.parentId
        ? (() => {
            const parent = absoluteNodePosition(node.parentId, nodeMap, cache);
            return { x: parent.x + node.position.x, y: parent.y + node.position.y };
        })()
        : { x: node.position.x, y: node.position.y };

    cache.set(nodeId, absolute);
    return absolute;
}

function buildFunctionRectMap(nodes: Node[]): Map<string, { x: number; y: number; w: number; h: number; fontScale: number }> {
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const cache = new Map<string, { x: number; y: number }>();
    const rects = new Map<string, { x: number; y: number; w: number; h: number; fontScale: number }>();

    for (const node of nodes) {
        if (node.type !== 'functionNode') { continue; }
        const position = absoluteNodePosition(node.id, nodeMap, cache);
        const w = node.measured?.width ?? (node.style?.width as number | undefined) ?? DEFAULT_FUNC_W;
        const h = node.measured?.height ?? (node.style?.height as number | undefined) ?? DEFAULT_FUNC_H;
        const fontScale = Math.max(Number((node.data as Record<string, unknown> | undefined)?.fontScale ?? 1), 0.05);
        rects.set(node.id, { x: position.x, y: position.y, w, h, fontScale });
    }

    return rects;
}

/** Default size when no UI layout is present */
export const DEFAULT_FUNC_W = DEFAULT_FUNCTION_WIDTH;
export const DEFAULT_FUNC_H = DEFAULT_FUNCTION_HEIGHT;

/** Triangle dimensions — must match InterfaceNode SVG constants */
export const IFACE_W = 60;
export const IFACE_H = 80;

export function interfaceDimensions(scale = 1): { width: number; height: number } {
    const normalized = Math.max(scale, 0.05);
    return {
        width: Math.max(IFACE_W * normalized, 8),
        height: Math.max(IFACE_H * normalized, 10),
    };
}

export type IfaceEdge = 'left' | 'right' | 'top' | 'bottom';

/** Determine which edge of the parent function an interface is on, from its top-left position. */
export function computeIfaceEdge(
    x: number,
    y: number,
    parentW: number,
    parentH: number,
    ifaceW = IFACE_W,
    ifaceH = IFACE_H,
): IfaceEdge {
    const cx = x + ifaceW / 2;
    const cy = y + ifaceH / 2;
    const dLeft = Math.abs(cx);
    const dRight = Math.abs(parentW - cx);
    const dTop = Math.abs(cy);
    const dBottom = Math.abs(parentH - cy);
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    if (min === dLeft) { return 'left'; }
    if (min === dRight) { return 'right'; }
    if (min === dTop) { return 'top'; }
    return 'bottom';
}

/** Snap an interface (IFACE_W × IFACE_H) to the nearest edge of its parent (pw × ph). */
export function snapIfaceToEdge(
    x: number,
    y: number,
    pw: number,
    ph: number,
    ifaceW = IFACE_W,
    ifaceH = IFACE_H,
): { x: number; y: number; edge: IfaceEdge } {
    const cx = x + ifaceW / 2;
    const cy = y + ifaceH / 2;
    const dLeft   = Math.abs(cx);
    const dRight  = Math.abs(pw - cx);
    const dTop    = Math.abs(cy);
    const dBottom = Math.abs(ph - cy);
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    const clampY = (v: number) => Math.max(-ifaceH / 2, Math.min(ph - ifaceH / 2, v));
    const clampX = (v: number) => Math.max(-ifaceW / 2, Math.min(pw - ifaceW / 2, v));
    if (min === dLeft)   { return { x: -ifaceW, y: clampY(cy - ifaceH / 2), edge: 'left' }; }
    if (min === dRight)  { return { x: pw,      y: clampY(cy - ifaceH / 2), edge: 'right' }; }
    if (min === dTop)    { return { x: clampX(cx - ifaceW / 2), y: -ifaceH, edge: 'top' }; }
    return                        { x: clampX(cx - ifaceW / 2), y: ph,      edge: 'bottom' };
}

function functionToNode(
    fn: FunctionModel,
    ui: UiModel,
    parentId?: string,
    depth = 0,
    cumulativeScale = 1,
): Node[] {
    const layout = layoutOf(ui, fn.id);
    let x = depth * 30;
    let y = depth * 30;
    let w = DEFAULT_FUNC_W;
    let h = DEFAULT_FUNC_H;
    let fontScale = cumulativeScale;

    if (parentId) {
        const parentLayout = layoutOf(ui, parentId);
        const mapped = mapRectToParentLocalPx(parentLayout, layout?.coordinates, fontScale);
        if (mapped) {
            x = mapped.x;
            y = mapped.y;
            w = mapped.w;
            h = mapped.h;
        }
        fontScale *= localScaleFactor(parentLayout);
    } else if (layout && layout.coordinates.length >= 4) {
        const outer = rectFromCoords(layout.coordinates);
        if (outer) {
            x = px(outer.x1);
            y = px(outer.y1);
            if (layout.rootCoordinates?.length === 4) {
                w = Math.max(px(rectWidth(outer)), 1);
                h = Math.max(px(rectHeight(outer)), 1);
            } else {
                w = Math.max(px(rectWidth(outer)), DEFAULT_FUNC_W);
                h = Math.max(px(rectHeight(outer)), DEFAULT_FUNC_H);
            }
        }
    }

    const node: Node = {
        id: fn.id,
        type: 'functionNode',
        position: { x, y },
        style: { width: w, height: h },
        data: {
            label: fn.name,
            language: fn.language,
            fn,
            fontScale,
        },
        ...(parentId ? { parentId, extent: 'parent' as const } : {}),
    };

    const ifaceNodes = buildInterfaceNodes(fn, ui, w, h, fontScale);
    const nested = fn.nestedFunctions.flatMap(child => functionToNode(child, ui, fn.id, depth + 1, fontScale));

    return [node, ...ifaceNodes, ...nested];
}

function ifacePositionFromLayout(
    layout: EntityLayout | undefined,
    parentLayout: EntityLayout | undefined,
    ifaceW: number,
    ifaceH: number,
): { x: number; y: number } | null {
    if (!layout || !parentLayout) { return null; }

    // Imported nested interfaces can carry both coordinate systems:
    // - coordinates: absolute canvas anchor on the host function border
    // - rootCoordinates: anchor in the host function's internal space
    // Draw the node from the external anchor when available so icon/handle placement
    // follows the outer border. Fall back to scoped coordinates for editor-created data
    // that only stores the internal point.
    if ((layout.rootCoordinates?.length ?? 0) >= 2 && layout.coordinates.length >= 2) {
        const parentRect = rectFromCoords(parentLayout.coordinates);
        if (parentRect) {
            return {
                x: px(layout.coordinates[0] - parentRect.x1) - ifaceW / 2,
                y: px(layout.coordinates[1] - parentRect.y1) - ifaceH / 2,
            };
        }
    }

    const posCoords = (layout.rootCoordinates?.length ?? 0) >= 2 ? layout.rootCoordinates! : layout.coordinates;
    if (posCoords.length < 2) { return null; }
    const mapped = mapPointToParentLocalPx(parentLayout, posCoords[0], posCoords[1]);
    return { x: mapped.x - ifaceW / 2, y: mapped.y - ifaceH / 2 };
}

function buildInterfaceNodes(fn: FunctionModel, ui: UiModel, parentW: number, parentH: number, fontScale: number): Node[] {
    const parentLayout = layoutOf(ui, fn.id);
    const { width: ifaceW, height: ifaceH } = interfaceDimensions(fontScale);

    const makeNode = (iface: InterfaceModel, idx: number, total: number, isProvided: boolean): Node => {
        const layout = layoutOf(ui, iface.id);
        const fromLayout = ifacePositionFromLayout(layout, parentLayout, ifaceW, ifaceH);
        let raw: { x: number; y: number };
        if (fromLayout) {
            raw = fromLayout;
        } else {
            // Fallback: PI stack on right edge, RI stack on left edge
            const spacing = parentH / (total + 1);
            const y = spacing * (idx + 1) - ifaceH / 2;
            raw = isProvided ? { x: parentW, y } : { x: -ifaceW, y };
        }
        // Always snap to nearest edge so loaded positions stay on the border
        const { x: posX, y: posY, edge } = snapIfaceToEdge(raw.x, raw.y, parentW, parentH, ifaceW, ifaceH);
        return {
            id: iface.id,
            type: 'interfaceNode',
            position: { x: posX, y: posY },
            data: { label: iface.name, iface, edge, fontScale, ifaceWidth: ifaceW, ifaceHeight: ifaceH },
            parentId: fn.id,
            // No extent:'parent' — interfaces live just outside the function border
            style: { width: ifaceW, height: ifaceH },
        };
    };

    return [
        ...fn.providedInterfaces.map((iface, idx) => makeNode(iface, idx, fn.providedInterfaces.length, true)),
        ...fn.requiredInterfaces.map((iface, idx) => makeNode(iface, idx, fn.requiredInterfaces.length, false)),
    ];
}

function connectionToEdge(conn: ConnectionModel, _ui: UiModel): Edge {
    return {
        id: conn.id,
        source: conn.sourceIfaceId,
        target: conn.targetIfaceId,
        label: conn.name,
        data: { conn },
        type: 'routedEdge',
    };
}

function connectionWaypointNodes(
    conn: ConnectionModel,
    ui: UiModel,
    maps: FunctionMaps,
    functionRects: Map<string, { x: number; y: number; w: number; h: number; fontScale: number }>,
): Node[] {
    const layout = ui.entities[conn.id];
    const nodes: Node[] = [];
    if (!layout?.coordinates || layout.coordinates.length < 2) { return nodes; }

    const sourceHostId = maps.functionByInterface.get(conn.sourceIfaceId);
    const targetHostId = maps.functionByInterface.get(conn.targetIfaceId);
    const containerId = findCommonAncestorFunction(sourceHostId, targetHostId, maps.parentByFunction);
    const containerLayout = containerId ? layoutOf(ui, containerId) : undefined;
    const containerRect = containerId ? functionRects.get(containerId) : undefined;
    const waypointScale = (containerRect?.fontScale ?? 1) * localScaleFactor(containerLayout);
    const size = waypointNodeSize(waypointScale);

    for (let i = 0; i + 1 < layout.coordinates.length; i += 2) {
        let centerX = layout.coordinates[i] * SC_SCALE;
        let centerY = layout.coordinates[i + 1] * SC_SCALE;

        if (containerLayout?.rootCoordinates?.length === 4 && containerRect) {
            const local = mapPointToParentContentLocalPx(
                containerLayout,
                layout.coordinates[i],
                layout.coordinates[i + 1],
                containerRect.fontScale,
            );
            centerX = containerRect.x + local.x;
            centerY = containerRect.y + local.y;
        }

        nodes.push({
            id: makeWaypointNodeId(conn.id, i / 2),
            type: 'waypointNode',
            position: {
                x: centerX - size / 2,
                y: centerY - size / 2,
            },
            width: size,
            height: size,
            measured: { width: size, height: size },
            draggable: true,
            selectable: true,
            deletable: true,
            data: { connectionId: conn.id, waypointIndex: i / 2, waypointSize: size },
            style: { width: size, height: size },
        });
    }

    return nodes;
}

export function buildGraph(iv: IvModel, ui: UiModel): { nodes: Node[]; edges: Edge[] } {
    const functionNodes = iv.functions.flatMap(fn => functionToNode(fn, ui));
    const maps = buildFunctionMaps(iv.functions);
    const functionRects = buildFunctionRectMap(functionNodes);
    const nodes = [
        ...functionNodes,
        ...iv.connections.flatMap(conn => connectionWaypointNodes(conn, ui, maps, functionRects)),
    ];
    const edges = iv.connections.map(conn => connectionToEdge(conn, ui));
    return { nodes, edges };
}
