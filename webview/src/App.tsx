import React, { useCallback, useEffect, useState } from 'react';
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
    WebviewMessage, NodeMove, PropertyModel, ParameterModel,
} from '../../src/model/types';
import { buildGraph, IFACE_W, IFACE_H, IfaceEdge, computeIfaceEdge, snapIfaceToEdge } from './transform';
import { FunctionNode } from './components/FunctionNode';
import { InterfaceNode } from './components/InterfaceNode';
import { AttributePanel } from './components/AttributePanel';
import { OptionsPanel, EditorOptions, DEFAULT_OPTIONS } from './components/OptionsPanel';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import { AddEntityDialog, DialogState } from './components/AddEntityDialog';
import { Palette } from './components/Palette';

const nodeTypes = {
    functionNode: FunctionNode,
    interfaceNode: InterfaceNode,
};

// VS Code webview API — injected by the host
declare const acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;
try { vscodeApi = acquireVsCodeApi(); } catch { /* running outside VS Code */ }

function post(msg: WebviewMessage): void {
    vscodeApi?.postMessage(msg);
}

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

    // ── Connect mode: click first function → select as source, click second → create RI+PI+connection
    const [connectMode, setConnectMode] = useState(false);
    const [connectSrc, setConnectSrc] = useState<{ id: string; relX: number; relY: number } | null>(null);

    const { screenToFlowPosition, zoomIn, zoomOut, fitView, getIntersectingNodes } = useReactFlow();

    // ── Receive messages from extension ─────────────────────────────────────
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data as ExtensionMessage;
            if (msg.type === 'load') {
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
    }, [locked, nodes, setNodes]);

    // ── Node resize → persist new size ──────────────────────────────────────
    const onNodesChangeWithResize: OnNodesChange = useCallback((changes: NodeChange[]) => {
        onNodesChange(changes);
        for (const change of changes) {
            if (change.type === 'dimensions' && change.resizing === false) {
                const w = (change as { dimensions?: { width: number; height: number } }).dimensions?.width ?? 800;
                const h = (change as { dimensions?: { width: number; height: number } }).dimensions?.height ?? 560;

                setNodes(nds => {
                    const fnNode = nds.find(n => n.id === change.id);
                    if (!fnNode) { return nds; }

                    // Post function resize to backend
                    post({
                        type: 'nodesMoved',
                        moves: [{
                            id: fnNode.id,
                            kind: 'function',
                            x: fnNode.position.x,
                            y: fnNode.position.y,
                            w,
                            h,
                            parentId: fnNode.parentId,
                        }],
                    });

                    // Re-snap all child interfaces to the new edges
                    const ifaceMoves: NodeMove[] = [];
                    const updated = nds.map(n => {
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
    }, [onNodesChange, setNodes]);

    // ── Connect ──────────────────────────────────────────────────────────────
    const onConnect = useCallback((params: Connection) => {
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
    }, [diagramData]);

    // ── Delete key → remove selected nodes/edges ─────────────────────────────
    const onNodesDelete = useCallback((deletedNodes: Node[]) => {
        const ids = deletedNodes.map(n => n.id);
        if (ids.length > 0) { post({ type: 'delete', ids }); }
    }, []);

    const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
        const ids = deletedEdges.map(e => e.id);
        if (ids.length > 0) { post({ type: 'delete', ids }); }
    }, []);

    // ── Drag interface handle → function node: create compatible interface + connect ──
    const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
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
    }, [diagramData, nodes, screenToFlowPosition, getIntersectingNodes, getAbsolutePos]);

    // ── Context menus ────────────────────────────────────────────────────────
    const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
        e.preventDefault();
        const rfPos = screenToFlowPosition({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
        setContextMenu({
            x: (e as MouseEvent).clientX,
            y: (e as MouseEvent).clientY,
            items: [
                {
                    label: '+ Add Function',
                    onClick: () => setDialog({ kind: 'addFunction', rfX: rfPos.x, rfY: rfPos.y }),
                },
                {
                    label: '+ Add Connection',
                    onClick: () => { setConnectMode(true); setConnectSrc(null); },
                },
                {
                    label: 'Build Skeletons',
                    onClick: () => post({ type: 'buildSkeletons' }),
                },
                {
                    label: 'Build',
                    onClick: () => post({ type: 'build' }),
                },
            ],
        });
    }, [screenToFlowPosition]);

    const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
        e.preventDefault();
        if (!diagramData) { return; }
        const entity = findEntity(diagramData.iv, node.id);
        const items: ContextMenuItem[] = [];

        if (entity && !isInterface(entity)) {
            const fn = entity as FunctionModel;
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
                    label: 'Edit Function',
                    onClick: () => post({ type: 'editFunction', id: fn.id }),
                },
                {
                    label: 'Delete Function',
                    danger: true,
                    onClick: () => post({ type: 'delete', ids: [fn.id] }),
                },
            );
        } else if (entity && isInterface(entity)) {
            items.push({
                label: 'Delete Interface',
                danger: true,
                onClick: () => post({ type: 'delete', ids: [entity.id] }),
            });
        }

        if (items.length > 0) {
            setContextMenu({ x: e.clientX, y: e.clientY, items });
        }
    }, [diagramData]);

    // ── Attribute panel callbacks ────────────────────────────────────────────
    const onUpdateFunction = useCallback((id: string, patch: { name?: string; language?: string; properties?: PropertyModel[] }) => {
        post({ type: 'updateFunction', id, ...patch });
    }, []);

    const onUpdateInterface = useCallback((id: string, patch: { name?: string; kind?: InterfaceKind; inheritPI?: boolean; parameters?: ParameterModel[] }) => {
        post({ type: 'updateInterface', id, ...patch });
    }, []);

    // ── Palette actions ──────────────────────────────────────────────────────
    const onPaletteAddFunction = useCallback(() => {
        // Add at viewport center
        const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setDialog({ kind: 'addFunction', rfX: center.x, rfY: center.y });
    }, [screenToFlowPosition]);

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
        <div style={{ width: '100vw', height: '100vh', background: options.canvasColor, position: 'relative', cursor: connectMode ? 'crosshair' : 'default' }}>
            <Palette
                onZoomIn={() => zoomIn()}
                onZoomOut={() => zoomOut()}
                onFitView={() => fitView({ padding: 0.1, maxZoom: 1 })}
                onToggleSnap={() => setOptions(o => ({ ...o, snapEnabled: !o.snapEnabled }))}
                snapEnabled={options.snapEnabled}
                onShowOptions={() => setOptionsVisible(v => !v)}
                onAddFunction={onPaletteAddFunction}
                onAddConnection={() => { setConnectMode(v => !v); setConnectSrc(null); }}
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
                edges={edges}
                onNodesChange={onNodesChangeWithResize}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
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
                <Background color="#313244" variant={BackgroundVariant.Dots} />
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
                    onChange={patch => setOptions(o => ({ ...o, ...patch }))}
                />
            )}

            {selected && (
                <AttributePanel
                    selected={selected}
                    schema={diagramData?.schema ?? { attrs: [] }}
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

