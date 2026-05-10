import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ReactFlow, Background, Controls, MiniMap,
    Node, Edge, NodeMouseHandler, NodeDragHandler, Connection,
    useNodesState, useEdgesState,
    BackgroundVariant, ConnectionMode, useReactFlow, ReactFlowProvider,
    NodeChange, OnNodesChange, OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
    DiagramData, ExtensionMessage, FunctionModel, InterfaceModel, InterfaceKind,
    NodeMove, PropertyModel, ParameterModel, EditorOptions, DEFAULT_OPTIONS,
} from '../../src/model/types';
import { buildGraph, IFACE_W, IFACE_H, IfaceEdge, computeIfaceEdge, snapIfaceToEdge } from './transform';
import { FunctionNode } from './components/FunctionNode';
import { InterfaceNode } from './components/InterfaceNode';
import { RoutedEdge } from './components/RoutedEdge';
import { post, vscodeApi } from './vscodeApi';
import { AttributePanel } from './components/AttributePanel';
import { OptionsPanel } from './components/OptionsPanel';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import { EdgeMenuContext } from './components/EdgeMenuContext';
import { AddEntityDialog, DialogState } from './components/AddEntityDialog';
import { Palette } from './components/Palette';

const nodeTypes = {
    functionNode: FunctionNode,
    interfaceNode: InterfaceNode,
};

const edgeTypes = {
    routedEdge: RoutedEdge,
};

function uuid(): string {
    return crypto.randomUUID();
}

/** Search all functions (incl. nested) for an entity matching id. */
function findEntity(iv: { functions: FunctionModel[] }, id: string): FunctionModel | InterfaceModel | null {
    const searchFn = (fn: FunctionModel): FunctionModel | InterfaceModel | null => {
        if (fn.id === id) { return fn; }
        for (const iface of [...fn.providedInterfaces, ...fn.requiredInterfaces]) {
            if (iface.id === id) { return iface; }
        }
        for (const child of fn.nestedFunctions) {
            const found = searchFn(child);
            if (found) { return found; }
        }
        return null;
    };
    for (const fn of iv.functions) {
        const found = searchFn(fn);
        if (found) { return found; }
    }
    return null;
}

function isInterface(e: FunctionModel | InterfaceModel | null): e is InterfaceModel {
    return e !== null && 'kind' in e;
}

function isFunction(e: FunctionModel | InterfaceModel | null): e is FunctionModel {
    return e !== null && !('kind' in e);
}

function snapToGrid(value: number, grid: number): number {
    return Math.round(value / grid) * grid;
}

// ─── Inner component (needs ReactFlow context for screenToFlowPosition) ─────

function DiagramEditor() {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [diagramData, setDiagramData] = useState<DiagramData | null>(null);
    const [selected, setSelected] = useState<FunctionModel | InterfaceModel | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [waiting, setWaiting] = useState(true);
    const [contextMenu, setContextMenu] = useState<{
        x: number; y: number; items: ContextMenuItem[];
    } | null>(null);
    const [dialog, setDialog] = useState<DialogState>(null);
    const [locked, setLocked] = useState(false);
    const [optionsVisible, setOptionsVisible] = useState(false);
    const [options, setOptions] = useState<EditorOptions>(DEFAULT_OPTIONS);
    const [pendingExportFormat, setPendingExportFormat] = useState<'png' | 'svg' | null>(null);
    const [clipboard, setClipboard] = useState<
        | { kind: 'function'; data: FunctionModel }
        | { kind: 'interface'; data: InterfaceModel }
        | null>(null);

    // ── Connect mode: click first function → select as source, click second → create RI+PI+connection
    const [connectMode, setConnectMode] = useState(false);
    const [connectSrc, setConnectSrc] = useState<{ id: string; relX: number; relY: number } | null>(null);

    const { screenToFlowPosition, zoomIn, zoomOut, fitView, getIntersectingNodes } = useReactFlow();

    // Edges with labelStyle applied reactively (fontSizeConn may change independently of diagram load)
    const styledEdges = useMemo(
        () => edges.map(e => ({
            ...e,
            labelStyle: { ...(e.labelStyle ?? {}), fontSize: options.fontSizeConn },
            data: { ...(e.data as Record<string, unknown> | undefined), locked },
        })),
        [edges, options.fontSizeConn, locked],
    );

    const selectedFunction = useMemo(
        () => isFunction(selected) ? selected : null,
        [selected],
    );

    // ── Receive messages from extension ─────────────────────────────────────
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data as ExtensionMessage;
            if (msg.type === 'options') {
                setOptions(msg.options);
            } else if (msg.type === 'requestExport') {
                setPendingExportFormat(msg.format);
            } else if (msg.type === 'load') {
                try {
                    setDiagramData(msg.data);
                    const { nodes: n, edges: e } = buildGraph(msg.data.iv, msg.data.ui);
                    setNodes(n);
                    setEdges(e);
                    setWaiting(false);
                    // Refresh selected entity from the new model
                    setSelected(prev => {
                        if (!prev) { return null; }
                        return findEntity(msg.data.iv, prev.id) ?? null;
                    });
                } catch (err) {
                    setLoadError(String(err));
                    setWaiting(false);
                }
            }
        };
        window.addEventListener('message', handler);
        if (vscodeApi) {
            post({ type: 'ready' });
        } else {
            setLoadError('acquireVsCodeApi is not available (not running inside VS Code?)');
            setWaiting(false);
        }
        return () => window.removeEventListener('message', handler);
    }, [setNodes, setEdges]);

    /** Compute the absolute flow-space position of a node by walking the parent chain. */
    const getAbsolutePos = useCallback((nodeId: string): { x: number; y: number } => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) { return { x: 0, y: 0 }; }
        if (!node.parentId) { return { x: node.position.x, y: node.position.y }; }
        const parent = getAbsolutePos(node.parentId);
        return { x: parent.x + node.position.x, y: parent.y + node.position.y };
    }, [nodes]);

    /** Given a click event on a function node, compute the snapped interface position
     *  (top-left of IFACE_W×IFACE_H box) in flow-pixel coords relative to the function's top-left. */
    const clickToIfacePos = useCallback((evt: React.MouseEvent, node: Node): { relX: number; relY: number } => {
        const absPos = getAbsolutePos(node.id);
        const flowClick = screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
        const relX_raw = flowClick.x - absPos.x;
        const relY_raw = flowClick.y - absPos.y;
        const pw = node.measured?.width ?? (node.style?.width as number | undefined) ?? 800;
        const ph = node.measured?.height ?? (node.style?.height as number | undefined) ?? 560;
        const { x: relX, y: relY } = snapIfaceToEdge(relX_raw - IFACE_W / 2, relY_raw - IFACE_H / 2, pw, ph);
        return { relX, relY };
    }, [getAbsolutePos, screenToFlowPosition]);

    // ── Node click → select entity, or pick connect-mode source/target ────────
    const onNodeClick: NodeMouseHandler = useCallback((evt, node) => {
        if (!diagramData) { return; }

        if (connectMode && node.type === 'functionNode') {
            if (!connectSrc) {
                // First click: select source function, record snapped border position
                setConnectSrc({ id: node.id, ...clickToIfacePos(evt, node) });
                return;
            }
            if (node.id !== connectSrc.id) {
                // Second click: create connected RI+PI and exit connect mode
                const { relX: piRelX, relY: piRelY } = clickToIfacePos(evt, node);
                post({
                    type: 'connectFunctions',
                    riId: uuid(),
                    piId: uuid(),
                    riFuncId: connectSrc.id,
                    piFuncId: node.id,
                    riRelX: connectSrc.relX,
                    riRelY: connectSrc.relY,
                    piRelX,
                    piRelY,
                });
            }
            setConnectMode(false);
            setConnectSrc(null);
            return;
        }

        setSelected(findEntity(diagramData.iv, node.id));
    }, [diagramData, connectMode, connectSrc, clickToIfacePos]);

    const onPaneClick = useCallback(() => {
        if (connectMode) {
            // Cancel connect mode on background click
            setConnectMode(false);
            setConnectSrc(null);
            return;
        }
        setSelected(null);
        setContextMenu(null);
    }, [connectMode]);

    // ── Drag stop → persist positions to extension ───────────────────────────
    const onNodeDragStop: NodeDragHandler = useCallback((_evt, node) => {
        if (locked) { return; }
        const kind = node.type === 'functionNode' ? 'function' : 'interface';
        let x = node.position.x;
        let y = node.position.y;
        const w = node.measured?.width ?? (node.style?.width as number | undefined) ?? 800;
        const h = node.measured?.height ?? (node.style?.height as number | undefined) ?? 560;

        if (node.type === 'interfaceNode') {
            const parentNode = nodes.find(n => n.id === node.parentId);
            if (parentNode) {
                const pw = parentNode.measured?.width ?? (parentNode.style?.width as number | undefined) ?? 800;
                const ph = parentNode.measured?.height ?? (parentNode.style?.height as number | undefined) ?? 560;
                const snapped = snapIfaceToEdge(x, y, pw, ph);
                x = snapped.x;
                y = snapped.y;
                setNodes(nds => nds.map(n => n.id === node.id
                    ? { ...n, position: { x, y }, data: { ...n.data, edge: snapped.edge } }
                    : n,
                ));
            }
        }

        post({
            type: 'nodesMoved',
            moves: [{ id: node.id, kind, x, y, w, h, parentId: node.parentId }],
        });

        // REQ-0370: reparent a root function when dragged into another function
        if (node.type === 'functionNode' && !node.parentId) {
            const center = { x: x + w / 2, y: y + h / 2 };
            let bestParent: Node | null = null;
            let bestArea = Infinity;
            for (const n of nodes) {
                if (n.type !== 'functionNode' || n.id === node.id || n.parentId) { continue; }
                const nW = n.measured?.width ?? (n.style?.width as number | undefined) ?? 800;
                const nH = n.measured?.height ?? (n.style?.height as number | undefined) ?? 560;
                if (center.x > n.position.x && center.x < n.position.x + nW &&
                    center.y > n.position.y && center.y < n.position.y + nH) {
                    const area = nW * nH;
                    if (area < bestArea) { bestArea = area; bestParent = n; }
                }
            }
            if (bestParent) {
                post({ type: 'reparentFunction', id: node.id, newParentId: bestParent.id });
            }
        }
    }, [locked, nodes, setNodes]);

    // ── Node resize → persist new size ──────────────────────────────────────
    const onNodesChangeWithResize: OnNodesChange = useCallback((changes: NodeChange[]) => {
        onNodesChange(changes);
        for (const change of changes) {
            if (change.type === 'dimensions' && change.resizing === false) {
                const rawW = (change as { dimensions?: { width: number; height: number } }).dimensions?.width ?? 800;
                const rawH = (change as { dimensions?: { width: number; height: number } }).dimensions?.height ?? 560;

                setNodes(nds => {
                    const fnNode = nds.find(n => n.id === change.id);
                    if (!fnNode) { return nds; }

                    const grid = Math.max(1, options.snapGridSize || 1);
                    const minW = options.snapEnabled ? Math.max(grid, Math.ceil(200 / grid) * grid) : 200;
                    const minH = options.snapEnabled ? Math.max(grid, Math.ceil(100 / grid) * grid) : 100;

                    let x = fnNode.position.x;
                    let y = fnNode.position.y;
                    let w = rawW;
                    let h = rawH;

                    if (options.snapEnabled) {
                        const snappedLeft = snapToGrid(fnNode.position.x, grid);
                        const snappedTop = snapToGrid(fnNode.position.y, grid);
                        const snappedRight = snapToGrid(fnNode.position.x + rawW, grid);
                        const snappedBottom = snapToGrid(fnNode.position.y + rawH, grid);

                        x = snappedLeft;
                        y = snappedTop;
                        w = Math.max(minW, snappedRight - snappedLeft);
                        h = Math.max(minH, snappedBottom - snappedTop);
                    }

                    // Post function resize to backend
                    post({
                        type: 'nodesMoved',
                        moves: [{
                            id: fnNode.id,
                            kind: 'function',
                            x,
                            y,
                            w,
                            h,
                            parentId: fnNode.parentId,
                        }],
                    });

                    // Re-snap all child interfaces to the new edges
                    const ifaceMoves: NodeMove[] = [];
                    const updated = nds.map(n => {
                        if (n.id === change.id) {
                            return {
                                ...n,
                                position: { x, y },
                                width: w,
                                height: h,
                                measured: { width: w, height: h },
                                style: { ...n.style, width: w, height: h },
                            };
                        }
                        if (n.parentId !== change.id || n.type !== 'interfaceNode') { return n; }
                        const snapped = snapIfaceToEdge(n.position.x, n.position.y, w, h);
                        ifaceMoves.push({
                            id: n.id, kind: 'interface',
                            x: snapped.x, y: snapped.y, w: IFACE_W, h: IFACE_H,
                            parentId: change.id,
                        });
                        return { ...n, position: { x: snapped.x, y: snapped.y }, data: { ...n.data, edge: snapped.edge } };
                    });
                    if (ifaceMoves.length > 0) {
                        post({ type: 'nodesMoved', moves: ifaceMoves });
                    }
                    return updated;
                });
            }
        }
    }, [onNodesChange, options.snapEnabled, options.snapGridSize, setNodes]);

    // ── Connect ──────────────────────────────────────────────────────────────
    const onConnect = useCallback((params: Connection) => {
        if (locked) { return; }
        if (!diagramData || !params.source || !params.target) { return; }
        const { iv } = diagramData;

        // Validate: source must be RI, target must be PI
        const srcEntity = findEntity(iv, params.source);
        const tgtEntity = findEntity(iv, params.target);
        if (!srcEntity || !tgtEntity) { return; }
        if (!isInterface(srcEntity) || !isInterface(tgtEntity)) { return; }

        const srcIface = srcEntity as InterfaceModel;
        const tgtIface = tgtEntity as InterfaceModel;

        // Swap direction if user connected backwards (PI→RI)
        let riId: string, piId: string;
        if (srcIface.type === 'required' && tgtIface.type === 'provided') {
            riId = srcIface.id; piId = tgtIface.id;
        } else if (srcIface.type === 'provided' && tgtIface.type === 'required') {
            riId = tgtIface.id; piId = srcIface.id;
        } else {
            return; // both same type — invalid
        }

        // Cyclic interfaces cannot be connected
        if (srcIface.kind === 'Cyclic' || tgtIface.kind === 'Cyclic') { return; }
        // Must be same kind
        if (srcIface.kind !== tgtIface.kind) { return; }

        post({ type: 'connect', id: uuid(), sourceIfaceId: riId, targetIfaceId: piId });
    }, [diagramData, locked]);

    // ── Delete key → remove selected nodes/edges ─────────────────────────────
    const onNodesDelete = useCallback((deletedNodes: Node[]) => {
        if (locked) { return; }
        const ids = deletedNodes.map(n => n.id);
        if (ids.length > 0) { post({ type: 'delete', ids }); }
    }, [locked]);

    const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
        if (locked) { return; }
        const ids = deletedEdges.map(e => e.id);
        if (ids.length > 0) { post({ type: 'delete', ids }); }
    }, [locked]);

    // ── Drag interface handle → function node: create compatible interface + connect ──
    const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
        if (locked) { return; }
        // If connection was valid, onConnect already handled it
        if (connectionState.isValid || !diagramData) { return; }
        const fromNodeId = (connectionState.fromNode as Node | null)?.id;
        if (!fromNodeId) { return; }
        const fromNode = nodes.find(n => n.id === fromNodeId);
        if (!fromNode || fromNode.type !== 'interfaceNode') { return; }

        const ev = event as MouseEvent | Touch;
        const clientX = 'clientX' in ev ? ev.clientX : (event as TouchEvent).touches[0].clientX;
        const clientY = 'clientY' in ev ? ev.clientY : (event as TouchEvent).touches[0].clientY;
        const flowPos = screenToFlowPosition({ x: clientX, y: clientY });

        // Find function node under drop point (excluding parent function)
        const hits = getIntersectingNodes(
            { x: flowPos.x - 1, y: flowPos.y - 1, width: 2, height: 2 },
            true,
        ) as Node[];
        const targetFnNode = hits.find(n => n.type === 'functionNode' && n.id !== fromNode.parentId);
        if (!targetFnNode) { return; }

        // Compute interface drop position on target function's border
        const absPos = getAbsolutePos(targetFnNode.id);
        const relX_raw = flowPos.x - absPos.x;
        const relY_raw = flowPos.y - absPos.y;
        const pw = targetFnNode.measured?.width ?? (targetFnNode.style?.width as number | undefined) ?? 800;
        const ph = targetFnNode.measured?.height ?? (targetFnNode.style?.height as number | undefined) ?? 560;
        const { x: relX, y: relY } = snapIfaceToEdge(relX_raw - IFACE_W / 2, relY_raw - IFACE_H / 2, pw, ph);

        post({
            type: 'connectToFunction',
            id: uuid(),
            connId: uuid(),
            existingIfaceId: fromNodeId,
            targetFuncId: targetFnNode.id,
            relRfX: relX,
            relRfY: relY,
        });
    }, [diagramData, getAbsolutePos, getIntersectingNodes, locked, nodes, screenToFlowPosition]);

    // ── Export image ─────────────────────────────────────────────────────────
    const onExportImage = useCallback(async (format: 'png' | 'svg') => {
        if (nodes.length === 0) { return; }

        const IFACE_W_EX = 60, IFACE_H_EX = 80;
        const KIND_COLORS: Record<string, string> = {
            Cyclic: '#a6e3a1', Sporadic: '#89b4fa', Protected: '#fab387', Unprotected: '#f38ba8',
        };
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // Resolve absolute flow-coordinate position for any node
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const absPos = (n: Node): { x: number; y: number } => {
            if (!n.parentId) { return { x: n.position.x, y: n.position.y }; }
            const parent = nodeMap.get(n.parentId);
            if (!parent) { return { x: n.position.x, y: n.position.y }; }
            const pp = absPos(parent);
            return { x: pp.x + n.position.x, y: pp.y + n.position.y };
        };

        // Compute bounding box over all nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
            const p = absPos(n);
            const w = n.measured?.width ?? IFACE_W_EX;
            const h = n.measured?.height ?? IFACE_H_EX;
            if (p.x < minX) { minX = p.x; }
            if (p.y < minY) { minY = p.y; }
            if (p.x + w > maxX) { maxX = p.x + w; }
            if (p.y + h > maxY) { maxY = p.y + h; }
        }

        const pad = 60;
        const svgW = Math.max(maxX - minX + pad * 2, 400);
        const svgH = Math.max(maxY - minY + pad * 2, 300);
        const ox = pad - minX;
        const oy = pad - minY;

        const parts: string[] = [];
        // viewBox lets us scale for PNG without losing precision in SVG export
        parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">`);
        parts.push(`<rect width="100%" height="100%" fill="${options.canvasColor}"/>`);

        // Edges (drawn below nodes)
        for (const e of edges) {
            const src = nodeMap.get(e.source);
            const tgt = nodeMap.get(e.target);
            if (!src || !tgt) { continue; }
            const sp = absPos(src), tp = absPos(tgt);
            const srcEdge = (src.data as Record<string,unknown>).edge as string ?? 'left';
            const tgtEdge = (tgt.data as Record<string,unknown>).edge as string ?? 'left';
            // Handle = outside midpoint of the triangle
            const hx = (n: Node, p: {x:number;y:number}, edge: string) => {
                const w = n.measured?.width ?? IFACE_W_EX;
                switch (edge) {
                    case 'right': return p.x + ox + w;
                    case 'top':   return p.x + ox + w / 2;
                    case 'bottom':return p.x + ox + w / 2;
                    default:      return p.x + ox;
                }
            };
            const hy = (n: Node, p: {x:number;y:number}, edge: string) => {
                const h = n.measured?.height ?? IFACE_H_EX;
                switch (edge) {
                    case 'top':    return p.y + oy;
                    case 'bottom': return p.y + oy + h;
                    default:       return p.y + oy + h / 2;
                }
            };
            const sx = hx(src, sp, srcEdge), sy = hy(src, sp, srcEdge);
            const tx2 = hx(tgt, tp, tgtEdge), ty2 = hy(tgt, tp, tgtEdge);
            const dx = Math.abs(tx2 - sx) * 0.5;
            // Stroke width relative to iface size
            const sw = Math.max(2, IFACE_W_EX * 0.05);
            parts.push(`<path d="M${sx},${sy} C${sx+dx},${sy} ${tx2-dx},${ty2} ${tx2},${ty2}" stroke="#6c7086" stroke-width="${sw}" fill="none"/>`);
            if (e.label) {
                const lx = (sx + tx2) / 2, ly = (sy + ty2) / 2;
                const labelFs = IFACE_H_EX * 0.4;
                const labelW = String(e.label).length * labelFs * 0.6 + 12;
                parts.push(`<rect x="${lx - labelW/2}" y="${ly - labelFs - 2}" width="${labelW}" height="${labelFs + 6}" fill="${options.canvasColor}" rx="3"/>`);
                parts.push(`<text x="${lx}" y="${ly}" text-anchor="middle" fill="#cdd6f4" font-size="${labelFs}" font-family="sans-serif">${esc(String(e.label))}</text>`);
            }
        }

        // Function nodes
        for (const n of nodes.filter(n => n.type === 'functionNode')) {
            const p = absPos(n);
            const x = p.x + ox, y = p.y + oy;
            const w = n.measured?.width ?? 200;
            const h = n.measured?.height ?? 100;
            const d = n.data as Record<string, unknown>;
            const caption = d.language ? `${d.label} [${d.language}]` : String(d.label ?? '');
            const fs = (d.fontSizeFn as number | undefined) ?? 90;
            // Header height matches FunctionNode: font-size * line-height + top/bottom padding
            const headerH = Math.round(fs * 1.2 + 12);
            parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#1e1e2e" stroke="#6c7086" stroke-width="3" rx="6"/>`);
            parts.push(`<rect x="${x+2}" y="${y+2}" width="${w-4}" height="${headerH}" fill="#313244" rx="4"/>`);
            // Square off the bottom corners of the header bar
            parts.push(`<rect x="${x+2}" y="${y+2+headerH/2}" width="${w-4}" height="${headerH/2}" fill="#313244"/>`);
            parts.push(`<line x1="${x}" y1="${y+headerH+2}" x2="${x+w}" y2="${y+headerH+2}" stroke="#6c7086" stroke-width="1"/>`);
            // Vertically center text in header
            const textY = y + 2 + headerH * 0.7;
            parts.push(`<text x="${x+10}" y="${textY}" fill="#cdd6f4" font-size="${fs}" font-weight="bold" font-family="sans-serif">${esc(caption)}</text>`);
        }

        // Interface nodes
        for (const n of nodes.filter(n => n.type === 'interfaceNode')) {
            const p = absPos(n);
            const x = p.x + ox, y = p.y + oy;
            const d = n.data as Record<string, unknown>;
            const iface = d.iface as { kind: string; type: string; name: string };
            const edge = (d.edge as string) ?? 'left';
            const color = KIND_COLORS[iface.kind] ?? '#cdd6f4';
            const fs = (d.fontSizeIface as number | undefined) ?? 45;

            const tipDir = iface.type === 'provided'
                ? (edge === 'left' ? 'right' : edge === 'right' ? 'left' : edge === 'top' ? 'down' : 'up')
                : edge;

            let pts: string;
            const W = IFACE_W_EX, H = IFACE_H_EX;
            switch (tipDir) {
                case 'right': pts = `${x},${y} ${x},${y+H} ${x+W},${y+H/2}`; break;
                case 'left':  pts = `${x+W},${y} ${x+W},${y+H} ${x},${y+H/2}`; break;
                case 'down':  pts = `${x},${y} ${x+W},${y} ${x+W/2},${y+H}`; break;
                default:      pts = `${x},${y+H} ${x+W},${y+H} ${x+W/2},${y}`; break; // up
            }
            parts.push(`<polygon points="${pts}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="2"/>`);

            // Label inside function body, matching InterfaceNode label placement
            const GAP = 8;
            let lx: number, ly: number, anchor: string;
            switch (edge) {
                case 'left':   lx = x + W + GAP; ly = y + H / 2 + fs * 0.35; anchor = 'start'; break;
                case 'right':  lx = x - GAP;     ly = y + H / 2 + fs * 0.35; anchor = 'end';   break;
                case 'top':    lx = x + W / 2;   ly = y + H + GAP + fs;      anchor = 'middle'; break;
                default:       lx = x + W / 2;   ly = y - GAP;                anchor = 'middle'; break;
            }
            parts.push(`<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="#cdd6f4" font-size="${fs}" font-family="sans-serif">${esc(iface.name)}</text>`);
        }

        parts.push('</svg>');
        const svgStr = parts.join('\n');
        // base64-encode so the extension handler (Buffer.from(...,'base64')) and
        // canvas Image loading both work correctly with the data: CSP directive
        const svgB64 = btoa(Array.from(new TextEncoder().encode(svgStr), b => String.fromCharCode(b)).join(''));
        const svgDataUrl = `data:image/svg+xml;base64,${svgB64}`;

        if (format === 'svg') {
            post({ type: 'exportImage', format, dataUrl: svgDataUrl });
            return;
        }

        // PNG: Chromium canvas max area is ~268 Mpx. Scale down to fit within 8192px
        // on the longest side, then render a new SVG at that pixel size.
        const MAX_PNG_PX = 8192;
        const pngScale = Math.min(1, MAX_PNG_PX / Math.max(svgW, svgH));
        const canvasW = Math.max(1, Math.round(svgW * pngScale));
        const canvasH = Math.max(1, Math.round(svgH * pngScale));

        // Replace width/height in the SVG so the browser renders it at canvas size
        const scaledSvgStr = svgStr.replace(
            `width="${svgW}" height="${svgH}"`,
            `width="${canvasW}" height="${canvasH}"`,
        );
        const scaledB64 = btoa(Array.from(new TextEncoder().encode(scaledSvgStr), b => String.fromCharCode(b)).join(''));
        const scaledDataUrl = `data:image/svg+xml;base64,${scaledB64}`;

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { post({ type: 'exportImage', format: 'png', dataUrl: svgDataUrl }); return; }
        await new Promise<void>(resolve => {
            const img = new Image();
            img.onload = () => { ctx.drawImage(img, 0, 0); resolve(); };
            img.onerror = () => resolve();
            img.src = scaledDataUrl;
        });
        const pngDataUrl = canvas.toDataURL('image/png');
        // 'data:,' means canvas backing store failed — fall back to SVG bytes
        if (pngDataUrl === 'data:,') {
            post({ type: 'exportImage', format: 'png', dataUrl: svgDataUrl });
        } else {
            post({ type: 'exportImage', format: 'png', dataUrl: pngDataUrl });
        }
    }, [nodes, edges, options.canvasColor]);

    useEffect(() => {
        if (!pendingExportFormat) { return; }
        void onExportImage(pendingExportFormat);
        setPendingExportFormat(null);
    }, [onExportImage, pendingExportFormat]);

    // ── Context menus ────────────────────────────────────────────────────────
    const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
        e.preventDefault();
        const rfPos = screenToFlowPosition({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
        const items: ContextMenuItem[] = [];
        if (!locked) {
            items.push(
                {
                    label: '+ Add Function',
                    onClick: () => setDialog({ kind: 'addFunction', rfX: rfPos.x, rfY: rfPos.y }),
                },
                {
                    label: '+ Add Connection',
                    onClick: () => { setConnectMode(true); setConnectSrc(null); },
                },
            );
        }
        if (!locked && clipboard?.kind === 'function') {
            items.push({
                label: 'Paste Function',
                onClick: () => post({ type: 'pasteFunction', newId: uuid(), source: clipboard.data, rfX: rfPos.x, rfY: rfPos.y }),
            });
        }
        items.push(
            {
                label: 'Build Skeletons',
                onClick: () => post({ type: 'buildSkeletons' }),
            },
            {
                label: 'Build',
                onClick: () => post({ type: 'build' }),
            },
            {
                label: 'Export Diagram as Image',
                onClick: () => post({ type: 'requestExport' }),
            },
        );
        setContextMenu({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, items });
    }, [clipboard, locked, screenToFlowPosition]);

    const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
        e.preventDefault();
        if (!diagramData) { return; }
        const entity = findEntity(diagramData.iv, node.id);
        const items: ContextMenuItem[] = [];

        if (entity && !isInterface(entity)) {
            const fn = entity as FunctionModel;
            if (!locked) {
                items.push(
                    {
                        label: '+ Add Provided Interface',
                        onClick: () => setDialog({ kind: 'addInterface', funcId: fn.id, funcName: fn.name, presetType: 'provided' }),
                    },
                    {
                        label: '+ Add Required Interface',
                        onClick: () => setDialog({ kind: 'addInterface', funcId: fn.id, funcName: fn.name, presetType: 'required' }),
                    },
                    {
                        label: 'Add Nested Function',
                        onClick: () => {
                            const abs = getAbsolutePos(fn.id);
                            setDialog({ kind: 'addFunction', rfX: abs.x + 100, rfY: abs.y + 100, parentId: fn.id });
                        },
                    },
                );
            }
            items.push({
                label: 'Copy Function',
                onClick: () => setClipboard({ kind: 'function', data: fn }),
            });
            if (!locked && clipboard?.kind === 'interface') {
                const iface = clipboard.data;
                const pw = node.measured?.width ?? 800;
                const ph = node.measured?.height ?? 560;
                const relRfX = iface.type === 'provided' ? pw : -IFACE_W;
                const relRfY = ph / 2 - IFACE_H / 2;
                items.push({
                    label: 'Paste Interface',
                    onClick: () => post({ type: 'pasteInterface', newId: uuid(), source: iface, funcId: fn.id, relRfX, relRfY }),
                });
            }
            if (!locked && node.parentId) {
                items.push({
                    label: 'Move to Root',
                    onClick: () => post({ type: 'reparentFunction', id: fn.id }),
                });
            }
            items.push(
                {
                    label: 'Edit Function',
                    onClick: () => post({ type: 'editFunction', id: fn.id }),
                },
            );
            if (!locked) {
                items.push({
                    label: 'Delete Function',
                    danger: true,
                    onClick: () => post({ type: 'delete', ids: [fn.id] }),
                });
            }
        } else if (entity && isInterface(entity)) {
            const iface = entity as InterfaceModel;
            items.push({
                label: 'Copy Interface',
                onClick: () => setClipboard({ kind: 'interface', data: iface }),
            });
            if (!locked) {
                items.push({
                    label: 'Delete Interface',
                    danger: true,
                    onClick: () => post({ type: 'delete', ids: [iface.id] }),
                });
            }
        }

        if (items.length > 0) {
            setContextMenu({ x: e.clientX, y: e.clientY, items });
        }
    }, [clipboard, diagramData, getAbsolutePos, locked]);

    // ── Attribute panel callbacks ────────────────────────────────────────────
    const updateOptions = useCallback((patch: Partial<EditorOptions>) => {
        setOptions(o => {
            const next = { ...o, ...patch };
            post({ type: 'updateOptions', options: next });
            return next;
        });
    }, []);

    const onUpdateFunction = useCallback((id: string, patch: { name?: string; language?: string; defaultImplementation?: string; isType?: boolean; fixedSystemElement?: boolean; properties?: PropertyModel[]; extraAttrs?: Record<string, string> }) => {
        if (locked) { return; }
        post({ type: 'updateFunction', id, ...patch });
    }, [locked]);

    const onUpdateInterface = useCallback((id: string, patch: { name?: string; kind?: InterfaceKind; inheritPI?: boolean; parameters?: ParameterModel[]; extraAttrs?: Record<string, string> }) => {
        if (locked) { return; }
        post({ type: 'updateInterface', id, ...patch });
    }, [locked]);

    // ── Compute PI params for connected RI (for parameter locking) ───────────
    const connectedPiParams = useMemo(() => {
        if (!selected || !isInterface(selected) || selected.type !== 'required' || !diagramData) { return undefined; }
        const conn = diagramData.iv.connections.find(c => c.sourceIfaceId === selected.id);
        if (!conn) { return undefined; }
        const pi = findEntity(diagramData.iv, conn.targetIfaceId);
        if (!pi || !isInterface(pi)) { return undefined; }
        return (pi as InterfaceModel).parameters;
    }, [selected, diagramData]);

    // ── Palette actions ──────────────────────────────────────────────────────
    const onPaletteAddFunction = useCallback(() => {
        if (locked) { return; }
        // Add at viewport center
        const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setDialog({ kind: 'addFunction', rfX: center.x, rfY: center.y });
    }, [locked, screenToFlowPosition]);

    const onPaletteAddInterface = useCallback((ifaceType: 'provided' | 'required') => {
        if (locked || !selectedFunction) { return; }
        setDialog({ kind: 'addInterface', funcId: selectedFunction.id, funcName: selectedFunction.name, presetType: ifaceType });
    }, [locked, selectedFunction]);

    // ── Dialog confirm ───────────────────────────────────────────────────────
    const onConfirmFunction = useCallback((name: string, language: string, rfX: number, rfY: number, parentId?: string) => {
        post({ type: 'addFunction', id: uuid(), name, language, rfX, rfY, parentId });
        setDialog(null);
    }, []);

    const onConfirmInterface = useCallback((name: string, kind: InterfaceKind, ifaceType: 'provided' | 'required', funcId: string) => {
        const parentNode = nodes.find(n => n.id === funcId);
        const pw = parentNode?.measured?.width ?? (parentNode?.style?.width as number | undefined) ?? 800;
        const ph = parentNode?.measured?.height ?? (parentNode?.style?.height as number | undefined) ?? 560;
        // PI on right edge, RI on left edge; centered vertically
        const relRfX = ifaceType === 'provided' ? pw : -IFACE_W;
        const relRfY = ph / 2 - IFACE_H / 2;
        post({ type: 'addInterface', id: uuid(), funcId, name, kind, ifaceType, relRfX, relRfY });
        setDialog(null);
    }, [nodes]);

    // ── Render ───────────────────────────────────────────────────────────────
    if (waiting) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: '#1e1e2e', color: '#cdd6f4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
                Loading diagram…
            </div>
        );
    }

    if (loadError) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: '#1e1e2e', color: '#f38ba8', padding: '2rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                Error: {loadError}
            </div>
        );
    }

    return (
        <EdgeMenuContext.Provider value={{ showContextMenu: (x, y, items) => setContextMenu({ x, y, items }) }}>
        <div style={{ width: '100vw', height: '100vh', background: options.canvasColor, position: 'relative', cursor: connectMode ? 'crosshair' : 'default' }}>
            <Palette
                onZoomIn={() => zoomIn()}
                onZoomOut={() => zoomOut()}
                onFitView={() => fitView({ padding: 0.1, maxZoom: 1 })}
                onToggleSnap={() => updateOptions({ snapEnabled: !options.snapEnabled })}
                snapEnabled={options.snapEnabled}
                onShowOptions={() => setOptionsVisible(v => !v)}
                onAddFunction={onPaletteAddFunction}
                onAddProvidedInterface={() => onPaletteAddInterface('provided')}
                onAddRequiredInterface={() => onPaletteAddInterface('required')}
                interfaceActionsEnabled={!locked && selectedFunction !== null}
                onAddConnection={() => { setConnectMode(v => !v); setConnectSrc(null); }}
                onExportImage={() => post({ type: 'requestExport' })}
                connectMode={connectMode}
                locked={locked}
                onToggleLock={() => setLocked(v => !v)}
                optionsVisible={optionsVisible}
            />
            <ReactFlow
                nodes={nodes.map(n => {
                    if (n.type !== 'functionNode') {
                        // Pass font size option into interface nodes too
                        return n.type === 'interfaceNode'
                            ? { ...n, data: { ...n.data, fontSizeIface: options.fontSizeIface } }
                            : n;
                    }
                    const isConnSrc = n.id === connectSrc?.id;
                    const isConnTarget = connectMode && !connectSrc;
                    return { ...n, data: { ...n.data, locked, isConnSrc, isConnTarget, fontSizeFn: options.fontSizeFn } };
                })}
                edges={styledEdges}
                onNodesChange={onNodesChangeWithResize}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                onNodesDelete={locked ? undefined : onNodesDelete}
                onEdgesDelete={locked ? undefined : onEdgesDelete}
                onPaneContextMenu={onPaneContextMenu}
                onNodeContextMenu={onNodeContextMenu}
                connectionMode={ConnectionMode.Loose}
                nodesDraggable={!locked && !connectMode}
                nodesConnectable={!locked}
                snapToGrid={options.snapEnabled}
                snapGrid={[options.snapGridSize, options.snapGridSize]}
                fitView
                fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
                minZoom={0.005}
                maxZoom={4}
                style={{ background: options.canvasColor, marginLeft: 44 }}
            >
                <Background
                    color="#313244"
                    variant={BackgroundVariant.Dots}
                    gap={options.snapGridSize}
                />
                <Controls style={{ display: 'none' }} />
                <MiniMap
                    nodeColor={(n) => n.type === 'interfaceNode' ? '#89b4fa' : '#313244'}
                    style={{ background: '#181825' }}
                    position="top-right"
                />
            </ReactFlow>

            {optionsVisible && !selected && (
                <OptionsPanel
                    options={options}
                    onChange={updateOptions}
                    onBrowseAttrFile={() => post({ type: 'browseAttrFile' })}
                />
            )}

            {selected && (
                <AttributePanel
                    selected={selected}
                    schema={diagramData?.schema ?? { attrs: [] }}
                    locked={locked}
                    connectedPiParams={connectedPiParams}
                    onUpdateFunction={onUpdateFunction}
                    onUpdateInterface={onUpdateInterface}
                />
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenu.items}
                    onClose={() => setContextMenu(null)}
                />
            )}

            <AddEntityDialog
                state={dialog}
                schema={diagramData?.schema}
                onConfirmFunction={onConfirmFunction}
                onConfirmInterface={onConfirmInterface}
                onCancel={() => setDialog(null)}
            />

            {/* Connect-mode status bar */}
            {connectMode && (
                <div style={{
                    position: 'fixed', bottom: 0, left: 44, right: 0,
                    background: '#313244', borderTop: '1px solid #89b4fa',
                    color: '#89b4fa', fontFamily: 'sans-serif', fontSize: 13,
                    padding: '6px 16px', zIndex: 100, pointerEvents: 'none',
                    display: 'flex', alignItems: 'center', gap: 16,
                }}>
                    <span style={{ fontWeight: 700 }}>Connect mode</span>
                    {connectSrc
                        ? <span>Source selected — now click the target function. Click background to cancel.</span>
                        : <span>Click the source function (will get a Required Interface). Click background to cancel.</span>
                    }
                </div>
            )}
        </div>
        </EdgeMenuContext.Provider>
    );
}

// Wrap in ReactFlowProvider so useReactFlow() works inside DiagramEditor
export default function App() {
    return (
        <ReactFlowProvider>
            <DiagramEditor />
        </ReactFlowProvider>
    );
}

