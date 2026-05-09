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
const IFACE_H = 28;
const IFACE_CHAR_W = 9; // approx px per character at 13px sans-serif
const IFACE_MIN_W = 120;
const IFACE_PADDING = 30; // icon + padding

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

function ifaceSize(name: string): { w: number; h: number } {
    const w = Math.max(IFACE_MIN_W, name.length * IFACE_CHAR_W + IFACE_PADDING);
    return { w, h: IFACE_H };
}

function ifacePosition(
    layout: EntityLayout | undefined,
    parentLayout: EntityLayout | undefined,
    parentH: number,
    ifaceW: number,
    idx: number,
    total: number,
): { x: number; y: number } {
    if (layout && parentLayout && layout.coordinates.length >= 2 && parentLayout.coordinates.length >= 4) {
        const [px1, py1] = parentLayout.coordinates;
        const [ix, iy] = layout.coordinates;
        return { x: px(ix - px1) - ifaceW / 2, y: px(iy - py1) - IFACE_H / 2 };
    }
    // Fallback: stack on left edge
    const spacing = parentH / (total + 1);
    return { x: -ifaceW / 2, y: spacing * (idx + 1) - IFACE_H / 2 };
}

function buildInterfaceNodes(fn: FunctionModel, ui: UiModel, parentW: number, parentH: number): Node[] {
    const parentLayout = layoutOf(ui, fn.id);
    const all: InterfaceModel[] = [...fn.providedInterfaces, ...fn.requiredInterfaces];
    return all.map((iface, idx) => {
        const layout = layoutOf(ui, iface.id);
        const { w, h } = ifaceSize(iface.name);
        const pos = ifacePosition(layout, parentLayout, parentH, w, idx, all.length);
        return {
            id: iface.id,
            type: 'interfaceNode',
            position: pos,
            data: { label: iface.name, iface },
            parentId: fn.id,
            extent: 'parent' as const,
            style: { width: w, height: h },
        };
    });
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
