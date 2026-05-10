import { Node, Edge } from '@xyflow/react';
import {
    IvModel, UiModel, FunctionModel, InterfaceModel, ConnectionModel, EntityLayout,
} from '../../src/model/types';
import { makeWaypointNodeId, WAYPOINT_NODE_SIZE } from './waypoints';

const SC_SCALE = 0.05;

function px(v: number): number { return v * SC_SCALE; }

function layoutOf(ui: UiModel, id: string): EntityLayout | undefined {
    return ui.entities[id];
}

/** Default size when no UI layout is present */
const DEFAULT_FUNC_W = 800;
const DEFAULT_FUNC_H = 560;

/** Triangle dimensions — must match InterfaceNode SVG constants */
export const IFACE_W = 60;
export const IFACE_H = 80;

export type IfaceEdge = 'left' | 'right' | 'top' | 'bottom';

/** Determine which edge of the parent function an interface is on, from its top-left position. */
export function computeIfaceEdge(x: number, y: number, parentW: number, parentH: number): IfaceEdge {
    const cx = x + IFACE_W / 2;
    const cy = y + IFACE_H / 2;
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
    x: number, y: number, pw: number, ph: number,
): { x: number; y: number; edge: IfaceEdge } {
    const cx = x + IFACE_W / 2;
    const cy = y + IFACE_H / 2;
    const dLeft   = Math.abs(cx);
    const dRight  = Math.abs(pw - cx);
    const dTop    = Math.abs(cy);
    const dBottom = Math.abs(ph - cy);
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    const clampY = (v: number) => Math.max(-IFACE_H / 2, Math.min(ph - IFACE_H / 2, v));
    const clampX = (v: number) => Math.max(-IFACE_W / 2, Math.min(pw - IFACE_W / 2, v));
    if (min === dLeft)   { return { x: -IFACE_W, y: clampY(cy - IFACE_H / 2), edge: 'left' }; }
    if (min === dRight)  { return { x: pw,        y: clampY(cy - IFACE_H / 2), edge: 'right' }; }
    if (min === dTop)    { return { x: clampX(cx - IFACE_W / 2), y: -IFACE_H,  edge: 'top' }; }
    return                        { x: clampX(cx - IFACE_W / 2), y: ph,         edge: 'bottom' };
}

/**
 * Compute the bounding box of a container's children (nested functions + their interfaces)
 * in the container's inner-canvas space (relative to originX/Y from rootCoordinates).
 */
function computeChildrenBBox(
    fn: FunctionModel, ui: UiModel, originX: number, originY: number,
): { w: number; h: number } | null {
    const PAD = 60;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const expandFn = (coords: number[]) => {
        if (coords.length < 4) { return; }
        maxX = Math.max(maxX, px(coords[2] - originX) + PAD);
        maxY = Math.max(maxY, px(coords[3] - originY) + PAD);
    };
    const expandIface = (coords: number[]) => {
        if (coords.length < 2) { return; }
        maxX = Math.max(maxX, px(coords[0] - originX) + IFACE_W + PAD);
        maxY = Math.max(maxY, px(coords[1] - originY) + IFACE_H + PAD);
    };

    // Own interfaces: 2-value rootCoordinates = position in inner canvas when present
    for (const iface of [...fn.providedInterfaces, ...fn.requiredInterfaces]) {
        const il = layoutOf(ui, iface.id);
        const ic = (il?.rootCoordinates?.length ?? 0) >= 2 ? il!.rootCoordinates! : il?.coordinates ?? [];
        expandIface(ic);
    }
    // Direct nested function extents and their interfaces (coordinates already in inner canvas space)
    for (const child of fn.nestedFunctions) {
        const cl = layoutOf(ui, child.id);
        if (cl) { expandFn(cl.coordinates); }
        for (const iface of [...child.providedInterfaces, ...child.requiredInterfaces]) {
            const il = layoutOf(ui, iface.id);
            if (il?.coordinates.length) { expandIface(il.coordinates); }
        }
    }

    if (maxX === -Infinity) { return null; }
    return { w: Math.max(maxX, DEFAULT_FUNC_W), h: Math.max(maxY, DEFAULT_FUNC_H) };
}

function functionToNode(
    fn: FunctionModel,
    ui: UiModel,
    parentId?: string,
    depth = 0,
): Node[] {
    const layout = layoutOf(ui, fn.id);
    let x = depth * 30;
    let y = depth * 30;
    let w = DEFAULT_FUNC_W;
    let h = DEFAULT_FUNC_H;

    // Containers (modern format) have rootCoordinates describing their expanded canvas.
    // Containers have rootCoordinates (inner canvas) and coordinates (outer canvas position).
    // Position the node using outer coordinates; size from the children bounding box.
    if (layout?.rootCoordinates?.length === 4) {
        const [rc_x1, rc_y1, rc_x2, rc_y2] = layout.rootCoordinates;
        // Outer-canvas position: where this function appears alongside its siblings
        if (layout.coordinates.length >= 2) {
            x = px(layout.coordinates[0]);
            y = px(layout.coordinates[1]);
        } else {
            x = px(rc_x1);
            y = px(rc_y1);
        }
        const bbox = computeChildrenBBox(fn, ui, rc_x1, rc_y1);
        w = bbox ? bbox.w : Math.max(px(rc_x2 - rc_x1), DEFAULT_FUNC_W);
        h = bbox ? bbox.h : Math.max(px(rc_y2 - rc_y1), DEFAULT_FUNC_H);
    } else if (layout && layout.coordinates.length >= 4) {
        const [x1, y1, x2, y2] = layout.coordinates;
        x = px(x1);
        y = px(y1);
        w = Math.max(px(x2 - x1), DEFAULT_FUNC_W);
        h = Math.max(px(y2 - y1), DEFAULT_FUNC_H);
    }

    // React Flow child nodes use positions relative to parent.
    // For the modern UI XML format the parent's rootCoordinates define the canvas origin;
    // for legacy (no rootCoordinates) fall back to the first two values of coordinates.
    let posX = x;
    let posY = y;
    if (parentId) {
        const parentLayout = layoutOf(ui, parentId);
        const originX = parentLayout?.rootCoordinates?.[0] ?? parentLayout?.coordinates?.[0] ?? 0;
        const originY = parentLayout?.rootCoordinates?.[1] ?? parentLayout?.coordinates?.[1] ?? 0;
        posX = x - px(originX);
        posY = y - px(originY);
    }

    const node: Node = {
        id: fn.id,
        type: 'functionNode',
        position: { x: posX, y: posY },
        style: { width: w, height: h },
        data: {
            label: fn.name,
            language: fn.language,
            fn,
        },
        ...(parentId ? { parentId, extent: 'parent' as const } : {}),
    };

    const ifaceNodes = buildInterfaceNodes(fn, ui, w, h);
    const nested = fn.nestedFunctions.flatMap(child => functionToNode(child, ui, fn.id, depth + 1));

    return [node, ...ifaceNodes, ...nested];
}

function ifacePositionFromLayout(
    layout: EntityLayout | undefined,
    parentLayout: EntityLayout | undefined,
): { x: number; y: number } | null {
    if (!layout || !parentLayout) { return null; }
    // Origin: parent's rootCoordinates[0,1] when the parent is a container (inner canvas);
    // otherwise parent's coordinates[0,1] (absolute position in the same canvas).
    const originX = parentLayout.rootCoordinates?.[0] ?? parentLayout.coordinates[0];
    const originY = parentLayout.rootCoordinates?.[1] ?? parentLayout.coordinates[1];
    if (originX === undefined || originY === undefined) { return null; }
    // Position: 2-value rootCoordinates = position in the parent's inner canvas (modern containers).
    // Fall back to coordinates for non-container parents or legacy format.
    const posCoords = (layout.rootCoordinates?.length ?? 0) >= 2 ? layout.rootCoordinates! : layout.coordinates;
    if (posCoords.length < 2) { return null; }
    const [ix, iy] = posCoords;
    return { x: px(ix - originX) - IFACE_W / 2, y: px(iy - originY) - IFACE_H / 2 };
}

function buildInterfaceNodes(fn: FunctionModel, ui: UiModel, parentW: number, parentH: number): Node[] {
    const parentLayout = layoutOf(ui, fn.id);

    const makeNode = (iface: InterfaceModel, idx: number, total: number, isProvided: boolean): Node => {
        const layout = layoutOf(ui, iface.id);
        const fromLayout = ifacePositionFromLayout(layout, parentLayout);
        let raw: { x: number; y: number };
        if (fromLayout) {
            raw = fromLayout;
        } else {
            // Fallback: PI stack on right edge, RI stack on left edge
            const spacing = parentH / (total + 1);
            const y = spacing * (idx + 1) - IFACE_H / 2;
            raw = isProvided ? { x: parentW, y } : { x: -IFACE_W, y };
        }
        // Always snap to nearest edge so loaded positions stay on the border
        const { x: posX, y: posY, edge } = snapIfaceToEdge(raw.x, raw.y, parentW, parentH);
        return {
            id: iface.id,
            type: 'interfaceNode',
            position: { x: posX, y: posY },
            data: { label: iface.name, iface, edge },
            parentId: fn.id,
            // No extent:'parent' — interfaces live just outside the function border
            style: { width: IFACE_W, height: IFACE_H },
        };
    };

    return [
        ...fn.providedInterfaces.map((iface, idx) => makeNode(iface, idx, fn.providedInterfaces.length, true)),
        ...fn.requiredInterfaces.map((iface, idx) => makeNode(iface, idx, fn.requiredInterfaces.length, false)),
    ];
}

function connectionToEdge(conn: ConnectionModel, ui: UiModel): Edge {
    return {
        id: conn.id,
        source: conn.sourceIfaceId,
        target: conn.targetIfaceId,
        label: conn.name,
        data: { conn },
        type: 'routedEdge',
    };
}

function connectionWaypointNodes(conn: ConnectionModel, ui: UiModel): Node[] {
    const layout = ui.entities[conn.id];
    const nodes: Node[] = [];
    if (!layout?.coordinates || layout.coordinates.length < 2) { return nodes; }

    for (let i = 0; i + 1 < layout.coordinates.length; i += 2) {
        const centerX = layout.coordinates[i] * SC_SCALE;
        const centerY = layout.coordinates[i + 1] * SC_SCALE;
        nodes.push({
            id: makeWaypointNodeId(conn.id, i / 2),
            type: 'waypointNode',
            position: {
                x: centerX - WAYPOINT_NODE_SIZE / 2,
                y: centerY - WAYPOINT_NODE_SIZE / 2,
            },
            width: WAYPOINT_NODE_SIZE,
            height: WAYPOINT_NODE_SIZE,
            measured: { width: WAYPOINT_NODE_SIZE, height: WAYPOINT_NODE_SIZE },
            draggable: true,
            selectable: true,
            deletable: true,
            data: { connectionId: conn.id, waypointIndex: i / 2 },
            style: { width: WAYPOINT_NODE_SIZE, height: WAYPOINT_NODE_SIZE },
        });
    }

    return nodes;
}

export function buildGraph(iv: IvModel, ui: UiModel): { nodes: Node[]; edges: Edge[] } {
    const nodes = [
        ...iv.functions.flatMap(fn => functionToNode(fn, ui)),
        ...iv.connections.flatMap(conn => connectionWaypointNodes(conn, ui)),
    ];
    const edges = iv.connections.map(conn => connectionToEdge(conn, ui));
    return { nodes, edges };
}
