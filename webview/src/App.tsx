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
    ContextParameterModel, DiagramData, ExtensionCapabilities, ExtensionMessage, FunctionModel, InterfaceModel, InterfaceKind,
    NodeMove, PropertyModel, ParameterModel, EditorOptions, DEFAULT_OPTIONS,
    DEFAULT_FUNCTION_WIDTH, DEFAULT_FUNCTION_HEIGHT,
} from '../../src/model/types';
import { buildGraph, IFACE_W, IFACE_H, IfaceEdge, computeIfaceEdge, interfaceDimensions, snapIfaceToEdge } from './transform';
import { FunctionNode } from './components/FunctionNode';
import { InterfaceNode } from './components/InterfaceNode';
import { RoutedEdge } from './components/RoutedEdge';
import { WaypointNode } from './components/WaypointNode';
import { post, vscodeApi } from './vscodeApi';
import { AttributePanel } from './components/AttributePanel';
import { OptionsPanel } from './components/OptionsPanel';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import { EdgeMenuContext } from './components/EdgeMenuContext';
import { AddEntityDialog, DialogState } from './components/AddEntityDialog';
import { SearchFunctionDialog } from './components/SearchFunctionDialog';
import { Palette } from './components/Palette';
import { renderDiagramImage } from './exportImage';
import { computeFocusVisibility } from './focus';
import { Waypoint, isWaypointNodeId, parseWaypointNodeId, waypointCenterFromNode } from './waypoints';

const nodeTypes = {
    functionNode: FunctionNode,
    interfaceNode: InterfaceNode,
    waypointNode: WaypointNode,
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

function nodeInterfaceDimensions(node: Node): { width: number; height: number } {
    const scale = Math.max(Number((node.data as Record<string, unknown> | undefined)?.fontScale ?? 1), 0.05);
    return interfaceDimensions(scale);
}

function collectConnectionWaypoints(nodes: Node[], connectionId: string, overrideNode?: Node): Waypoint[] {
    return nodes
        .filter(node => {
            const parsed = parseWaypointNodeId(node.id);
            return parsed?.connectionId === connectionId;
        })
        .map(node => {
            if (overrideNode && node.id === overrideNode.id) { return overrideNode; }
            return node;
        })
        .sort((a, b) => {
            const left = parseWaypointNodeId(a.id);
            const right = parseWaypointNodeId(b.id);
            return (left?.index ?? 0) - (right?.index ?? 0);
        })
        .map(waypointCenterFromNode);
}

function replaceConnectionWaypointNodes(nodes: Node[], connectionId: string, waypoints: Waypoint[]): Node[] {
    const existing = nodes.filter(node => parseWaypointNodeId(node.id)?.connectionId === connectionId);
    const preserved = nodes.filter(node => parseWaypointNodeId(node.id)?.connectionId !== connectionId);
    const size = existing[0]?.width
        ?? existing[0]?.measured?.width
        ?? Number((existing[0]?.data as Record<string, unknown> | undefined)?.waypointSize ?? 20);
    return [
        ...preserved,
        ...waypoints.map((waypoint, index) => ({
            id: `${connectionId}::wp::${index}`,
            type: 'waypointNode',
            position: { x: waypoint.x - size / 2, y: waypoint.y - size / 2 },
            width: size,
            height: size,
            measured: { width: size, height: size },
            draggable: true,
            selectable: true,
            deletable: true,
            data: { connectionId, waypointIndex: index, waypointSize: size },
            style: { width: size, height: size },
        })),
    ];
}

function flattenFunctions(functions: FunctionModel[]): FunctionModel[] {
    const flat: FunctionModel[] = [];
    const visit = (fn: FunctionModel) => {
        flat.push(fn);
        fn.nestedFunctions.forEach(visit);
    };
    functions.forEach(visit);
    return flat;
}

// ─── Inner component (needs ReactFlow context for screenToFlowPosition) ─────

function DiagramEditor() {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [diagramData, setDiagramData] = useState<DiagramData | null>(null);
    const [capabilities, setCapabilities] = useState<ExtensionCapabilities>({
        canBuild: true,
        canBuildSkeletons: true,
        canBrowseAttrFile: true,
        canEditFunction: true,
    });
    const [selected, setSelected] = useState<FunctionModel | InterfaceModel | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [waiting, setWaiting] = useState(true);
    const [contextMenu, setContextMenu] = useState<{
        x: number; y: number; items: ContextMenuItem[];
    } | null>(null);
    const [dialog, setDialog] = useState<DialogState>(null);
    const [locked, setLocked] = useState(false);
    const [focusEnabled, setFocusEnabled] = useState(false);
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

    const { screenToFlowPosition, zoomIn, zoomOut, fitView, getIntersectingNodes, setCenter, getZoom } = useReactFlow();

    // Edges with derived render data applied reactively (options may change independently of diagram load)
    const styledEdges = useMemo(
        () => edges.map(e => ({
            ...e,
            data: {
                ...(e.data as Record<string, unknown> | undefined),
                locked,
                waypoints: collectConnectionWaypoints(nodes, e.id),
                waypointSize: nodes.find(node => parseWaypointNodeId(node.id)?.connectionId === e.id)?.width
                    ?? Number((e.data as Record<string, unknown> | undefined)?.waypointSize ?? 20),
                fontSizeConn: options.fontSizeConn,
                canvasColor: options.canvasColor,
                showConnectionLabels: options.showConnectionLabels,
                connectionColor: options.ivConnectionColor,
                connectionFontColor: options.ivConnectionFontColor,
                connectionThickness: options.ivConnectionThickness,
            },
        })),
        [edges, nodes, options.canvasColor, options.fontSizeConn, options.ivConnectionColor, options.ivConnectionFontColor, options.ivConnectionThickness, options.showConnectionLabels, locked],
    );

    const selectedFunction = useMemo(
        () => isFunction(selected) ? selected : null,
        [selected],
    );

    const allFunctions = useMemo(
        () => diagramData ? flattenFunctions(diagramData.iv.functions) : [],
        [diagramData],
    );

    const focusVisibility = useMemo(
        () => computeFocusVisibility(focusEnabled, selected, nodes, edges),
        [edges, focusEnabled, nodes, selected],
    );

    const displayedNodes = useMemo(() => {
        const enhancedNodes = nodes.map(n => {
            const fontScale = Math.max(Number((n.data as Record<string, unknown> | undefined)?.fontScale ?? 1), 0.05);
            if (n.type !== 'functionNode') {
                return n.type === 'interfaceNode'
                    ? {
                        ...n,
                        data: {
                            ...n.data,
                            fontSizeIface: options.fontSizeIface * fontScale,
                            showInterfaceNames: options.showInterfaceNames,
                            interfaceColor: options.ivInterfaceColor,
                            interfaceFontColor: options.ivInterfaceFontColor,
                        },
                    }
                    : n;
            }
            const isConnSrc = n.id === connectSrc?.id;
            const isConnTarget = connectMode && !connectSrc;
            return {
                ...n,
                data: {
                    ...n.data,
                    locked,
                    isConnSrc,
                    isConnTarget,
                    fontSizeFn: options.fontSizeFn * fontScale,
                    functionColor: options.ivFunctionColor,
                    functionFontColor: options.ivFunctionFontColor,
                    functionBodyColor: options.ivFunctionBodyColor,
                },
            };
        });

        if (!focusVisibility) { return enhancedNodes; }

        return enhancedNodes.filter(node => {
            if (node.type === 'functionNode') {
                return focusVisibility.visibleFunctionIds.has(node.id);
            }
            if (node.type === 'interfaceNode') {
                return focusVisibility.visibleInterfaceIds.has(node.id);
            }
            if (node.type === 'waypointNode') {
                const parsed = parseWaypointNodeId(node.id);
                return parsed ? focusVisibility.visibleEdgeIds.has(parsed.connectionId) : true;
            }
            return true;
        });
    }, [connectMode, connectSrc, focusVisibility, locked, nodes, options.fontSizeFn, options.fontSizeIface, options.ivFunctionBodyColor, options.ivFunctionColor, options.ivFunctionFontColor, options.ivInterfaceColor, options.ivInterfaceFontColor, options.showInterfaceNames]);

    const displayedEdges = useMemo(() => {
        if (!focusVisibility) { return styledEdges; }
        return styledEdges.filter(edge => focusVisibility.visibleEdgeIds.has(edge.id));
    }, [focusVisibility, styledEdges]);

    // ── Receive messages from extension ─────────────────────────────────────
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data as ExtensionMessage;
            if (msg.type === 'capabilities') {
                setCapabilities(msg.capabilities);
            } else if (msg.type === 'options') {
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
        const pw = node.measured?.width ?? (node.style?.width as number | undefined) ?? DEFAULT_FUNCTION_WIDTH;
        const ph = node.measured?.height ?? (node.style?.height as number | undefined) ?? DEFAULT_FUNCTION_HEIGHT;
        const iface = nodeInterfaceDimensions(node);
        const { x: relX, y: relY } = snapIfaceToEdge(relX_raw - iface.width / 2, relY_raw - iface.height / 2, pw, ph, iface.width, iface.height);
        return { relX, relY };
    }, [getAbsolutePos, screenToFlowPosition]);

    // ── Node click → select entity, or pick connect-mode source/target ────────
    const onNodeClick: NodeMouseHandler = useCallback((evt, node) => {
        if (!diagramData) { return; }

        if (isWaypointNodeId(node.id)) {
            setSelected(null);
            return;
        }

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
        if (!focusEnabled) {
            setSelected(null);
        }
        setContextMenu(null);
    }, [connectMode, focusEnabled]);

    // ── Drag stop → persist positions to extension ───────────────────────────
    const onNodeDragStop: NodeDragHandler = useCallback((_evt, node) => {
        if (locked) { return; }
        if (node.type === 'waypointNode') {
            const waypointSize = node.width
                ?? node.measured?.width
                ?? Number((node.data as Record<string, unknown> | undefined)?.waypointSize ?? 20);
            const waypointNode = {
                ...node,
                width: waypointSize,
                height: waypointSize,
                measured: node.measured ?? { width: waypointSize, height: waypointSize },
            };
            const parsed = parseWaypointNodeId(node.id);
            if (!parsed) { return; }
            post({
                type: 'updateConnectionWaypoints',
                id: parsed.connectionId,
                waypoints: collectConnectionWaypoints(nodes, parsed.connectionId, waypointNode),
            });
            return;
        }
        const kind = node.type === 'functionNode' ? 'function' : 'interface';
        let x = node.position.x;
        let y = node.position.y;
        const w = node.measured?.width ?? (node.style?.width as number | undefined) ?? DEFAULT_FUNCTION_WIDTH;
        const h = node.measured?.height ?? (node.style?.height as number | undefined) ?? DEFAULT_FUNCTION_HEIGHT;

        if (node.type === 'interfaceNode') {
            const parentNode = nodes.find(n => n.id === node.parentId);
            if (parentNode) {
                const pw = parentNode.measured?.width ?? (parentNode.style?.width as number | undefined) ?? DEFAULT_FUNCTION_WIDTH;
                const ph = parentNode.measured?.height ?? (parentNode.style?.height as number | undefined) ?? DEFAULT_FUNCTION_HEIGHT;
                const snapped = snapIfaceToEdge(x, y, pw, ph, w, h);
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
                const nW = n.measured?.width ?? (n.style?.width as number | undefined) ?? DEFAULT_FUNCTION_WIDTH;
                const nH = n.measured?.height ?? (n.style?.height as number | undefined) ?? DEFAULT_FUNCTION_HEIGHT;
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
                const rawW = (change as { dimensions?: { width: number; height: number } }).dimensions?.width ?? DEFAULT_FUNCTION_WIDTH;
                const rawH = (change as { dimensions?: { width: number; height: number } }).dimensions?.height ?? DEFAULT_FUNCTION_HEIGHT;

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
                        const ifaceW = n.measured?.width ?? (n.style?.width as number | undefined) ?? IFACE_W;
                        const ifaceH = n.measured?.height ?? (n.style?.height as number | undefined) ?? IFACE_H;
                        const snapped = snapIfaceToEdge(n.position.x, n.position.y, w, h, ifaceW, ifaceH);
                        ifaceMoves.push({
                            id: n.id, kind: 'interface',
                            x: snapped.x, y: snapped.y, w: ifaceW, h: ifaceH,
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

        const srcNode = nodes.find(node => node.id === srcIface.id);
        const tgtNode = nodes.find(node => node.id === tgtIface.id);
        const isProxyConnection = srcIface.type === tgtIface.type
            && areFunctionNodesInProxyRelation(nodes, srcNode?.parentId, tgtNode?.parentId);

        // Swap direction if user connected backwards (PI→RI)
        let riId: string, piId: string;
        if (srcIface.type === 'required' && tgtIface.type === 'provided') {
            riId = srcIface.id; piId = tgtIface.id;
        } else if (srcIface.type === 'provided' && tgtIface.type === 'required') {
            riId = tgtIface.id; piId = srcIface.id;
        } else if (isProxyConnection) {
            riId = srcIface.id; piId = tgtIface.id;
        } else {
            return; // both same type — invalid
        }

        // Cyclic interfaces cannot be connected
        if (srcIface.kind === 'Cyclic' || tgtIface.kind === 'Cyclic') { return; }
        // Must be same kind
        if (srcIface.kind !== tgtIface.kind) { return; }

        post({ type: 'connect', id: uuid(), sourceIfaceId: riId, targetIfaceId: piId });
    }, [diagramData, locked, nodes]);

    // ── Delete key → remove selected nodes/edges ─────────────────────────────
    const onNodesDelete = useCallback((deletedNodes: Node[]) => {
        if (locked) { return; }
        const entityIds = deletedNodes.filter(n => !isWaypointNodeId(n.id)).map(n => n.id);
        if (entityIds.length > 0) {
            post({ type: 'delete', ids: entityIds });
        }

        const waypointConnectionIds = [...new Set(deletedNodes
            .map(n => parseWaypointNodeId(n.id)?.connectionId)
            .filter((id): id is string => !!id))];
        for (const connectionId of waypointConnectionIds) {
            const deletedIds = new Set(deletedNodes.map(n => n.id));
            const remaining = nodes
                .filter(n => parseWaypointNodeId(n.id)?.connectionId === connectionId && !deletedIds.has(n.id))
                .sort((a, b) => (parseWaypointNodeId(a.id)?.index ?? 0) - (parseWaypointNodeId(b.id)?.index ?? 0))
                .map(waypointCenterFromNode);
            setNodes(current => replaceConnectionWaypointNodes(current, connectionId, remaining));
            post({ type: 'updateConnectionWaypoints', id: connectionId, waypoints: remaining });
        }
    }, [locked]);

    const onSelectionDragStop = useCallback((_evt: React.MouseEvent, draggedNodes: Node[]) => {
        if (locked) { return; }
        const waypointConnectionIds = [...new Set(draggedNodes
            .map(node => parseWaypointNodeId(node.id)?.connectionId)
            .filter((id): id is string => !!id))];
        for (const connectionId of waypointConnectionIds) {
            post({
                type: 'updateConnectionWaypoints',
                id: connectionId,
                waypoints: collectConnectionWaypoints(nodes, connectionId),
            });
        }
    }, [locked, nodes]);

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
        const pw = targetFnNode.measured?.width ?? (targetFnNode.style?.width as number | undefined) ?? DEFAULT_FUNCTION_WIDTH;
        const ph = targetFnNode.measured?.height ?? (targetFnNode.style?.height as number | undefined) ?? DEFAULT_FUNCTION_HEIGHT;
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
        const rendered = await renderDiagramImage({
            nodes,
            edges,
            options,
            format,
            rasterizeSvgToPngDataUrl: async ({ svg, canvasWidth, canvasHeight }) => {
                const svgDataUrl = `data:image/svg+xml;base64,${btoa(Array.from(new TextEncoder().encode(svg), byte => String.fromCharCode(byte)).join(''))}`;
                const canvas = document.createElement('canvas');
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return null;
                }

                await new Promise<void>(resolve => {
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0);
                        resolve();
                    };
                    img.onerror = () => resolve();
                    img.src = svgDataUrl;
                });

                return canvas.toDataURL('image/png');
            },
        });
        if (!rendered) { return; }
        post({ type: 'exportImage', format, dataUrl: rendered.dataUrl });
    }, [nodes, edges, options]);

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
        items.push({
            label: 'Search Function',
            onClick: () => setDialog({ kind: 'searchFunction' }),
        });
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
        const buildItems: ContextMenuItem[] = [];
        if (capabilities.canBuild) {
            buildItems.push(
                { label: 'Clean', onClick: () => post({ type: 'buildClean' }) },
                { label: 'Build Debug', onClick: () => post({ type: 'buildDebug' }) },
                { label: 'Build Release', onClick: () => post({ type: 'buildRelease' }) },
                { label: 'Run', onClick: () => post({ type: 'buildRun' }) },
            );
        }
        if (capabilities.canBuildSkeletons) {
            buildItems.push({
                label: 'Build Skeletons',
                onClick: () => post({ type: 'buildSkeletons' }),
            });
        }
        if (buildItems.length > 0) {
            items.push({
                label: 'Build',
                children: buildItems,
            });
        }
        items.push({
            label: 'Export Diagram as Image',
            onClick: () => post({ type: 'requestExport' }),
        });
        setContextMenu({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, items });
    }, [capabilities.canBuild, capabilities.canBuildSkeletons, clipboard, locked, screenToFlowPosition]);

    const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
        e.preventDefault();
        if (!diagramData) { return; }
        const entity = findEntity(diagramData.iv, node.id);
        const items: ContextMenuItem[] = [];

        if (node.type === 'waypointNode') {
            const parsed = parseWaypointNodeId(node.id);
            if (!parsed) { return; }
            const currentWaypoints = collectConnectionWaypoints(nodes, parsed.connectionId);
            items.push(
                {
                    label: 'Remove Node',
                    onClick: () => {
                        const next = currentWaypoints.filter((_, index) => index !== parsed.index);
                        setNodes(current => replaceConnectionWaypointNodes(current, parsed.connectionId, next));
                        post({ type: 'updateConnectionWaypoints', id: parsed.connectionId, waypoints: next });
                    },
                },
                {
                    label: 'Remove Connection',
                    danger: true,
                    onClick: () => post({ type: 'delete', ids: [parsed.connectionId] }),
                },
            );
            setContextMenu({ x: e.clientX, y: e.clientY, items });
            return;
        }

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
                const ifaceSize = nodeInterfaceDimensions(node);
                const pw = node.measured?.width ?? DEFAULT_FUNCTION_WIDTH;
                const ph = node.measured?.height ?? DEFAULT_FUNCTION_HEIGHT;
                const relRfX = iface.type === 'provided' ? pw : -ifaceSize.width;
                const relRfY = ph / 2 - ifaceSize.height / 2;
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
            if (capabilities.canEditFunction) {
                items.push({
                    label: 'Edit Function',
                    onClick: () => post({ type: 'editFunction', id: fn.id }),
                });
            }
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
    }, [capabilities.canEditFunction, clipboard, diagramData, getAbsolutePos, locked]);

    // ── Attribute panel callbacks ────────────────────────────────────────────
    const updateOptions = useCallback((patch: Partial<EditorOptions>) => {
        setOptions(o => {
            const next = { ...o, ...patch };
            post({ type: 'updateOptions', options: next });
            return next;
        });
    }, []);

    const onUpdateFunction = useCallback((id: string, patch: { name?: string; language?: string; defaultImplementation?: string; isType?: boolean; fixedSystemElement?: boolean; contextParameters?: ContextParameterModel[]; properties?: PropertyModel[]; extraAttrs?: Record<string, string> }) => {
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
        const visited = new Set<string>();
        const queue = [selected.id];

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) { continue; }
            visited.add(currentId);

            for (const conn of diagramData.iv.connections) {
                let neighborId: string | undefined;
                let currentIsSource = false;
                if (conn.sourceIfaceId === currentId) {
                    neighborId = conn.targetIfaceId;
                    currentIsSource = true;
                } else if (conn.targetIfaceId === currentId) {
                    neighborId = conn.sourceIfaceId;
                } else {
                    continue;
                }

                const neighbor = findEntity(diagramData.iv, neighborId);
                if (!neighbor || !isInterface(neighbor)) { continue; }

                if (neighbor.type === 'provided' && currentIsSource) {
                    return neighbor.parameters;
                }
                if (neighbor.type === 'required' && !visited.has(neighbor.id)) {
                    queue.push(neighbor.id);
                }
            }
        }

        return undefined;
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
        const ifaceSize = parentNode ? nodeInterfaceDimensions(parentNode) : { width: IFACE_W, height: IFACE_H };
        const pw = parentNode?.measured?.width ?? (parentNode?.style?.width as number | undefined) ?? DEFAULT_FUNCTION_WIDTH;
        const ph = parentNode?.measured?.height ?? (parentNode?.style?.height as number | undefined) ?? DEFAULT_FUNCTION_HEIGHT;
        // PI on right edge, RI on left edge; centered vertically
        const relRfX = ifaceType === 'provided' ? pw : -ifaceSize.width;
        const relRfY = ph / 2 - ifaceSize.height / 2;
        post({ type: 'addInterface', id: uuid(), funcId, name, kind, ifaceType, relRfX, relRfY });
        setDialog(null);
    }, [nodes]);

    const onSelectFunctionFromSearch = useCallback((functionId: string) => {
        if (!diagramData) { return; }

        const functionEntity = findEntity(diagramData.iv, functionId);
        const functionNode = nodes.find(node => node.id === functionId && node.type === 'functionNode');
        if (!functionEntity || !isFunction(functionEntity) || !functionNode) {
            setDialog(null);
            return;
        }

        const absolute = getAbsolutePos(functionId);
        const width = functionNode.measured?.width ?? (functionNode.style?.width as number | undefined) ?? DEFAULT_FUNCTION_WIDTH;
        const height = functionNode.measured?.height ?? (functionNode.style?.height as number | undefined) ?? DEFAULT_FUNCTION_HEIGHT;

        setSelected(functionEntity);
        setDialog(null);
        setCenter(absolute.x + width / 2, absolute.y + height / 2, { zoom: getZoom(), duration: 250 });
    }, [diagramData, getAbsolutePos, getZoom, nodes, setCenter]);

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
                onToggleFocus={() => setFocusEnabled(enabled => !enabled)}
                focusEnabled={focusEnabled}
                focusDisabled={!focusEnabled && !selected}
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
                nodes={displayedNodes}
                edges={displayedEdges}
                onNodesChange={onNodesChangeWithResize}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onNodeDragStop={onNodeDragStop}
                onSelectionDragStop={onSelectionDragStop}
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
                {options.showMinimap && (
                    <MiniMap
                        nodeColor={(n) => n.type === 'interfaceNode' ? '#89b4fa' : '#313244'}
                        style={{ background: '#181825' }}
                        position="top-right"
                    />
                )}
            </ReactFlow>

            {optionsVisible && !selected && (
                <OptionsPanel
                    options={options}
                    onChange={updateOptions}
                    canBrowseAttrFile={capabilities.canBrowseAttrFile}
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

            <SearchFunctionDialog
                open={dialog?.kind === 'searchFunction'}
                functions={allFunctions.map(fn => ({ id: fn.id, name: fn.name, language: fn.language }))}
                onSelect={onSelectFunctionFromSearch}
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

