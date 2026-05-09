import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ReactFlow, Background, Controls, MiniMap,
    Node, Edge, NodeMouseHandler, NodeDragHandler, Connection,
    useNodesState, useEdgesState,
    BackgroundVariant, ConnectionMode, useReactFlow, ReactFlowProvider,
    NodeChange, OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
    DiagramData, ExtensionMessage, FunctionModel, InterfaceModel, InterfaceKind, WebviewMessage,
} from '../../src/model/types';
import { buildGraph } from './transform';
import { FunctionNode } from './components/FunctionNode';
import { InterfaceNode } from './components/InterfaceNode';
import { AttributePanel } from './components/AttributePanel';
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

    // Track ctrl-drag: source function node id
    const ctrlDragSource = useRef<string | null>(null);

    const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();

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

    // ── Node click → select entity ───────────────────────────────────────────
    const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
        if (!diagramData) { return; }
        setSelected(findEntity(diagramData.iv, node.id));
    }, [diagramData]);

    const onPaneClick = useCallback(() => {
        setSelected(null);
        setContextMenu(null);
    }, []);

    // ── Drag stop → persist positions to extension ───────────────────────────
    const onNodeDragStop: NodeDragHandler = useCallback((_evt, node) => {
        if (locked) { return; }
        const kind = node.type === 'functionNode' ? 'function' : 'interface';
        const w = (node.measured?.width ?? (node.style?.width as number | undefined) ?? 800);
        const h = (node.measured?.height ?? (node.style?.height as number | undefined) ?? 560);
        post({
            type: 'nodesMoved',
            moves: [{
                id: node.id,
                kind,
                x: node.position.x,
                y: node.position.y,
                w,
                h,
                parentId: node.parentId,
            }],
        });
    }, [locked]);

    // ── Node resize → persist new size ──────────────────────────────────────
    const onNodesChangeWithResize: OnNodesChange = useCallback((changes: NodeChange[]) => {
        onNodesChange(changes);
        for (const change of changes) {
            if (change.type === 'dimensions' && change.resizing === false) {
                const node = nodes.find(n => n.id === change.id);
                if (!node) { continue; }
                const w = change.dimensions?.width ?? (node.style?.width as number | undefined) ?? 800;
                const h = change.dimensions?.height ?? (node.style?.height as number | undefined) ?? 560;
                post({
                    type: 'nodesMoved',
                    moves: [{
                        id: node.id,
                        kind: 'function',
                        x: node.position.x,
                        y: node.position.y,
                        w,
                        h,
                        parentId: node.parentId,
                    }],
                });
            }
        }
    }, [onNodesChange, nodes]);

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
    const onUpdateFunction = useCallback((id: string, patch: { name?: string; language?: string }) => {
        post({ type: 'updateFunction', id, ...patch });
    }, []);

    const onUpdateInterface = useCallback((id: string, patch: { name?: string; kind?: InterfaceKind }) => {
        post({ type: 'updateInterface', id, ...patch });
    }, []);

    // ── Ctrl+drag: create connected PI+RI between two functions ─────────────
    const onNodeMouseDown: NodeMouseHandler = useCallback((evt, node) => {
        if (evt.ctrlKey && node.type === 'functionNode') {
            ctrlDragSource.current = node.id;
        }
    }, []);

    const onNodeMouseUp: NodeMouseHandler = useCallback((_evt, node) => {
        const srcId = ctrlDragSource.current;
        ctrlDragSource.current = null;
        if (!srcId || node.type !== 'functionNode' || node.id === srcId) { return; }
        // Create matched RI on src, PI on target, and connect
        post({
            type: 'connectFunctions',
            riId: uuid(),
            piId: uuid(),
            riFuncId: srcId,
            piFuncId: node.id,
        });
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
        // Position the new interface at the left or right edge of the parent function
        const parentNode = nodes.find(n => n.id === funcId);
        const pw = parentNode?.measured?.width ?? (parentNode?.style?.width as number | undefined) ?? 200;
        const ph = parentNode?.measured?.height ?? (parentNode?.style?.height as number | undefined) ?? 140;
        const relRfX = ifaceType === 'provided' ? pw - 60 : -60;
        const relRfY = ph / 2 - 14;
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
        <div style={{ width: '100vw', height: '100vh', background: '#1e1e2e', position: 'relative' }}>
            <Palette
                onZoomIn={() => zoomIn()}
                onZoomOut={() => zoomOut()}
                onFitView={() => fitView({ padding: 0.1, maxZoom: 1 })}
                onShowOptions={() => setOptionsVisible(v => !v)}
                onAddFunction={onPaletteAddFunction}
                locked={locked}
                onToggleLock={() => setLocked(v => !v)}
                optionsVisible={optionsVisible}
            />
            <ReactFlow
                nodes={nodes.map(n => n.type === 'functionNode' ? { ...n, data: { ...n.data, locked } } : n)}
                edges={edges}
                onNodesChange={onNodesChangeWithResize}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                onNodesDelete={locked ? undefined : onNodesDelete}
                onEdgesDelete={locked ? undefined : onEdgesDelete}
                onPaneContextMenu={onPaneContextMenu}
                onNodeContextMenu={onNodeContextMenu}
                onNodeMouseDown={onNodeMouseDown}
                onNodeMouseUp={onNodeMouseUp}
                connectionMode={ConnectionMode.Loose}
                nodesDraggable={!locked}
                nodesConnectable={!locked}
                fitView
                fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
                minZoom={0.05}
                maxZoom={4}
                style={{ background: '#1e1e2e', marginLeft: 44 }}
            >
                <Background color="#313244" variant={BackgroundVariant.Dots} />
                <Controls style={{ display: 'none' }} />
                <MiniMap
                    nodeColor={(n) => n.type === 'interfaceNode' ? '#89b4fa' : '#313244'}
                    style={{ background: '#181825' }}
                    position="top-right"
                />
            </ReactFlow>

            {(selected || optionsVisible) && (
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

