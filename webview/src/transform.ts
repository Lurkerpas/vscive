import { Node, Edge } from '@xyflow/react';
import {
    IvModel, UiModel, FunctionModel, InterfaceModel, ConnectionModel, EntityLayout,
} from '../../src/model/types';

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
    if (layout && layout.coordinates.length >= 4) {
        const [x1, y1, x2, y2] = layout.coordinates;
        x = px(x1);
        y = px(y1);
        w = Math.max(px(x2 - x1), DEFAULT_FUNC_W);
        h = Math.max(px(y2 - y1), DEFAULT_FUNC_H);
    }

    // React Flow child nodes use positions relative to parent
    const posX = parentId ? x - (layoutOf(ui, parentId)?.coordinates[0] ?? 0) * SC_SCALE : x;
    const posY = parentId ? y - (layoutOf(ui, parentId)?.coordinates[1] ?? 0) * SC_SCALE : y;

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
    if (layout && parentLayout && layout.coordinates.length >= 2 && parentLayout.coordinates.length >= 4) {
        const [px1, py1] = parentLayout.coordinates;
        const [ix, iy] = layout.coordinates;
        return { x: px(ix - px1) - IFACE_W / 2, y: px(iy - py1) - IFACE_H / 2 };
    }
    return null;
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

function connectionToEdge(conn: ConnectionModel): Edge {
    return {
        id: conn.id,
        source: conn.sourceIfaceId,
        target: conn.targetIfaceId,
        label: conn.name,
        data: { conn },
        type: 'straight',
    };
}

export function buildGraph(iv: IvModel, ui: UiModel): { nodes: Node[]; edges: Edge[] } {
    const nodes = iv.functions.flatMap(fn => functionToNode(fn, ui));
    const edges = iv.connections.map(connectionToEdge);
    return { nodes, edges };
}
