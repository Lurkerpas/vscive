import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    Controls,
    Edge,
    Handle,
    MiniMap,
    Node,
    NodeDragHandler,
    OnConnect,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
    BoardModel,
    DvAvailableFunction,
    DvAvailableMessage,
    DvConnectionModel,
    DvDeviceModel,
    DvDiagramData,
    DvExtensionCapabilities,
    DvExtensionMessage,
    DvModel,
    DvNodeModel,
    DvWebviewMessage,
    EditorOptions,
    DEFAULT_OPTIONS,
} from '../../src/model/types';
import { post, vscodeApi } from './vscodeApi';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import { buildDvGraph, connectionEndpointsByDeviceId, deviceById, DV_DEVICE_HEIGHT, DV_DEVICE_WIDTH, DV_NODE_HEIGHT, DV_NODE_WIDTH, snapDeviceToEdge } from './dvTransform';

type Selection =
    | { kind: 'node'; id: string }
    | { kind: 'device'; id: string }
    | { kind: 'connection'; id: string }
    | null;

const PANEL_STYLE: React.CSSProperties = {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 320,
    background: '#181825',
    borderLeft: '1px solid #313244',
    padding: 10,
    overflowY: 'auto',
    fontFamily: 'monospace',
    zIndex: 15,
};

const SECTION_TITLE: React.CSSProperties = { color: '#cba6f7', fontWeight: 'bold', marginBottom: 8 };
const ROW: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 };
const LABEL: React.CSSProperties = { color: '#a6adc8', fontSize: 11 };
const INPUT: React.CSSProperties = {
    background: '#1e1e2e', color: '#cdd6f4', border: '1px solid #45475a', borderRadius: 4,
    padding: '4px 6px', fontSize: 11, fontFamily: 'monospace', width: '100%', boxSizing: 'border-box',
};
const BTN: React.CSSProperties = { background: '#313244', color: '#cdd6f4', border: '1px solid #45475a', borderRadius: 4, padding: '5px 8px', cursor: 'pointer', fontSize: 11 };
const BTN_PRIMARY: React.CSSProperties = { ...BTN, background: '#89b4fa', color: '#1e1e2e', borderColor: '#89b4fa' };
const LIST: React.CSSProperties = { border: '1px solid #313244', borderRadius: 6, overflow: 'auto', maxHeight: 260 };

const DV_NODE_HEADER_FONT_SIZE = 12;
const DV_NODE_BODY_FONT_SIZE = 11;
const DV_DEVICE_FONT_SIZE = 10;

function uuid(): string {
    return crypto.randomUUID();
}

function scaleDvFont(baseSize: number, configuredSize: number, defaultSize: number, minSize: number): number {
    return Math.max(minSize, (baseSize * configuredSize) / defaultSize);
}

function dvNodeHeaderFontSize(options: EditorOptions): number {
    return scaleDvFont(DV_NODE_HEADER_FONT_SIZE, options.fontSizeFn, DEFAULT_OPTIONS.fontSizeFn, 9);
}

function dvNodeBodyFontSize(options: EditorOptions): number {
    return scaleDvFont(DV_NODE_BODY_FONT_SIZE, options.fontSizeFn, DEFAULT_OPTIONS.fontSizeFn, 8);
}

function dvDeviceFontSize(options: EditorOptions): number {
    return scaleDvFont(DV_DEVICE_FONT_SIZE, options.fontSizeIface, DEFAULT_OPTIONS.fontSizeIface, 7);
}

function applyDvNodePresentation(nodes: Node[], options: EditorOptions): Node[] {
    const headerFontSize = dvNodeHeaderFontSize(options);
    const bodyFontSize = dvNodeBodyFontSize(options);
    const deviceFontSize = dvDeviceFontSize(options);

    return nodes.map(node => {
        if (node.type === 'dvNode') {
            return {
                ...node,
                data: { ...(node.data as object), headerFontSize, bodyFontSize },
            };
        }

        if (node.type === 'dvDevice') {
            return {
                ...node,
                data: { ...(node.data as object), showName: options.showDeviceNames, fontSizeDevice: deviceFontSize },
            };
        }

        return node;
    });
}

function DvNodeRenderer({ data }: { data: { node: DvNodeModel; summary: string; overflow: number; headerFontSize?: number; bodyFontSize?: number } }) {
    const headerFontSize = data.headerFontSize ?? DV_NODE_HEADER_FONT_SIZE;
    const bodyFontSize = data.bodyFontSize ?? DV_NODE_BODY_FONT_SIZE;

    return (
        <div style={{ width: '100%', height: '100%', background: '#1e1e2e', border: '2px solid #6c7086', borderRadius: 8, color: '#cdd6f4', boxSizing: 'border-box' }}>
            <div style={{ background: '#313244', padding: '8px 10px', borderTopLeftRadius: 6, borderTopRightRadius: 6, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: headerFontSize, lineHeight: 1.2 }}>
                {data.node.name} [{data.node.type || data.node.namespace || 'Board'}]
            </div>
            <div style={{ padding: 10, fontSize: bodyFontSize, fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.25 }}>
                <div>Partition: {data.node.partition.name || 'Partition_1'}</div>
                <div>Functions: {data.node.partition.functions.length}</div>
                <div style={{ color: '#a6adc8' }}>{data.summary || 'No deployed functions'}</div>
                {data.overflow > 0 && <div style={{ color: '#89b4fa' }}>+{data.overflow} more</div>}
            </div>
        </div>
    );
}

function DvDeviceRenderer({ data }: { data: { device: DvDeviceModel; edge: string; showName?: boolean; fontSizeDevice?: number } }) {
    return (
        <>
            <Handle type="target" position={Position.Left} style={{ background: '#89b4fa', width: 8, height: 8 }} />
            <div style={{ width: '100%', height: '100%', background: '#313244', border: '1px solid #6c7086', borderRadius: 14, color: '#cdd6f4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: data.fontSizeDevice ?? DV_DEVICE_FONT_SIZE, fontFamily: 'sans-serif', padding: '0 8px', boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data.showName === false ? data.device.port || data.device.name : `${data.device.name}${data.device.port && data.device.port !== data.device.name ? ` (${data.device.port})` : ''}`}
            </div>
            <Handle type="source" position={Position.Right} style={{ background: '#89b4fa', width: 8, height: 8 }} />
        </>
    );
}

const nodeTypes = {
    dvNode: DvNodeRenderer,
    dvDevice: DvDeviceRenderer,
};

function regexFilter<T>(items: T[], query: string, haystack: (item: T) => string): T[] {
    if (!query.trim()) {
        return items;
    }
    try {
        const pattern = new RegExp(query, 'i');
        return items.filter(item => pattern.test(haystack(item)));
    } catch {
        return items.filter(item => haystack(item).toLowerCase().includes(query.trim().toLowerCase()));
    }
}

function BoardPickerDialog({ boards, open, onConfirm, onCancel }: { boards: BoardModel[]; open: boolean; onConfirm: (board: BoardModel) => void; onCancel: () => void }) {
    const [query, setQuery] = useState('');
    useEffect(() => { if (!open) { setQuery(''); } }, [open]);
    const filtered = useMemo(() => regexFilter(boards, query, board => `${board.name} ${board.type} ${board.namespace}`), [boards, query]);
    if (!open) { return null; }
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onMouseDown={event => { if (event.target === event.currentTarget) { onCancel(); } }}>
            <div style={{ width: 540, maxHeight: '70vh', background: '#1e1e2e', border: '1px solid #45475a', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={SECTION_TITLE}>Add Node</div>
                <input style={INPUT} autoFocus placeholder="Filter boards" value={query} onChange={event => setQuery(event.target.value)} />
                <div style={{ ...LIST, maxHeight: 360 }}>
                    {filtered.map(board => (
                        <button key={`${board.type}:${board.name}`} onClick={() => onConfirm(board)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', color: '#cdd6f4', border: 'none', padding: '10px 12px', borderBottom: '1px solid #313244', cursor: 'pointer' }}>
                            <div style={{ fontWeight: 'bold' }}>{board.name}</div>
                            <div style={{ color: '#a6adc8', fontSize: 11 }}>{board.type}</div>
                        </button>
                    ))}
                    {filtered.length === 0 && <div style={{ padding: 12, color: '#a6adc8' }}>No matching boards.</div>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={BTN} onClick={onCancel}>Close</button></div>
            </div>
        </div>
    );
}

function SearchNodeDialog({ open, nodes, onSelect, onCancel }: { open: boolean; nodes: DvNodeModel[]; onSelect: (nodeId: string) => void; onCancel: () => void }) {
    const [query, setQuery] = useState('');
    useEffect(() => { if (!open) { setQuery(''); } }, [open]);
    const filtered = useMemo(() => regexFilter(nodes, query, node => `${node.name} ${node.type} ${node.nodeLabel}`), [nodes, query]);
    if (!open) { return null; }
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onMouseDown={event => { if (event.target === event.currentTarget) { onCancel(); } }}>
            <div style={{ width: 460, maxHeight: '70vh', background: '#1e1e2e', border: '1px solid #45475a', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={SECTION_TITLE}>Search Node</div>
                <input style={INPUT} autoFocus placeholder="Filter nodes" value={query} onChange={event => setQuery(event.target.value)} />
                <div style={{ ...LIST, maxHeight: 320 }}>
                    {filtered.map(node => (
                        <button key={node.id} onClick={() => onSelect(node.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', color: '#cdd6f4', border: 'none', padding: '10px 12px', borderBottom: '1px solid #313244', cursor: 'pointer' }}>
                            <div style={{ fontWeight: 'bold' }}>{node.name}</div>
                            <div style={{ color: '#a6adc8', fontSize: 11 }}>{node.type}</div>
                        </button>
                    ))}
                    {filtered.length === 0 && <div style={{ padding: 12, color: '#a6adc8' }}>No matching nodes.</div>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={BTN} onClick={onCancel}>Close</button></div>
            </div>
        </div>
    );
}

function DvPalette({ snapEnabled, focusEnabled, locked, optionsVisible, onZoomIn, onZoomOut, onFitView, onToggleSnap, onToggleFocus, onAddNode, onSearchNode, onExportImage, onShowOptions, onToggleLock }: {
    snapEnabled: boolean;
    focusEnabled: boolean;
    locked: boolean;
    optionsVisible: boolean;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFitView: () => void;
    onToggleSnap: () => void;
    onToggleFocus: () => void;
    onAddNode: () => void;
    onSearchNode: () => void;
    onExportImage: () => void;
    onShowOptions: () => void;
    onToggleLock: () => void;
}) {
    const button = (title: string, icon: string, onClick: () => void, active?: boolean) => (
        <button title={title} onClick={onClick} style={{ width: 36, height: 36, border: 'none', borderRadius: 6, background: active ? '#45475a' : 'transparent', color: active ? '#89b4fa' : '#cdd6f4', cursor: 'pointer', fontSize: 18 }}>{icon}</button>
    );
    return (
        <div style={{ position: 'absolute', left: 0, top: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 4px', background: '#181825', borderRight: '1px solid #313244', zIndex: 20 }}>
            {button('Zoom In', '＋', onZoomIn)}
            {button('Zoom Out', '－', onZoomOut)}
            {button('Zoom to Fit', '⊡', onFitView)}
            {button('Snap to Grid', '⊞', onToggleSnap, snapEnabled)}
            {button('Focus', '◎', onToggleFocus, focusEnabled)}
            <div style={{ width: 24, height: 1, background: '#45475a', margin: '4px auto' }} />
            {button('Search Node', '⌕', onSearchNode)}
            {button('Add Node', '＋▭', onAddNode)}
            <div style={{ width: 24, height: 1, background: '#45475a', margin: '4px auto' }} />
            {button('Export Diagram as Image', '⬇', onExportImage)}
            {button('Show Options', '⚙', onShowOptions, optionsVisible)}
            {button(locked ? 'Unlock Diagram' : 'Lock Diagram', locked ? '🔒' : '🔓', onToggleLock, locked)}
        </div>
    );
}

function DvDiagramEditor() {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [diagramData, setDiagramData] = useState<DvDiagramData | null>(null);
    const [options, setOptions] = useState<EditorOptions>(DEFAULT_OPTIONS);
    const [capabilities, setCapabilities] = useState<DvExtensionCapabilities>({ canBrowseBoardsFile: true, canBuild: true });
    const [selection, setSelection] = useState<Selection>(null);
    const [waiting, setWaiting] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);
    const [focusEnabled, setFocusEnabled] = useState(false);
    const [locked, setLocked] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
    const [boardPickerOpen, setBoardPickerOpen] = useState(false);
    const [searchNodeOpen, setSearchNodeOpen] = useState(false);
    const [pendingAddPosition, setPendingAddPosition] = useState<{ x: number; y: number } | null>(null);
    const [pendingExportFormat, setPendingExportFormat] = useState<'png' | 'svg' | null>(null);
    const [functionFilter, setFunctionFilter] = useState('');
    const [messageFilter, setMessageFilter] = useState('');
    const [functionScope, setFunctionScope] = useState<'all' | 'deployed' | 'undeployed'>('all');
    const [messageScope, setMessageScope] = useState<'all' | 'deployed' | 'undeployed'>('all');
    const [checkedFunctionIds, setCheckedFunctionIds] = useState<string[]>([]);
    const [checkedMessageKeys, setCheckedMessageKeys] = useState<string[]>([]);
    const reactFlow = useReactFlow();
    const optionsRef = useRef(options);

    useEffect(() => {
        optionsRef.current = options;
    }, [options]);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data as DvExtensionMessage;
            if (message.type === 'loadDv') {
                setDiagramData(message.data);
                const graph = buildDvGraph(message.data.dv, message.data.ui);
                setNodes(applyDvNodePresentation(graph.nodes, optionsRef.current));
                setEdges(graph.edges);
                setWaiting(false);
                setSelection(current => current && resolveSelection(message.data.dv, current) ? current : null);
            } else if (message.type === 'options') {
                setOptions(message.options);
            } else if (message.type === 'capabilitiesDv') {
                setCapabilities(message.capabilities);
            } else if (message.type === 'requestExport') {
                setPendingExportFormat(message.format);
            }
        };
        window.addEventListener('message', handler);
        if (vscodeApi) {
            post({ type: 'ready' } satisfies DvWebviewMessage);
        } else {
            setLoadError('acquireVsCodeApi is not available');
            setWaiting(false);
        }
        return () => window.removeEventListener('message', handler);
    }, [options.showDeviceNames, setEdges, setNodes]);

    useEffect(() => {
        setNodes(existing => applyDvNodePresentation(existing, options));
    }, [options, setNodes]);

    useEffect(() => {
        if (!pendingExportFormat) {
            return;
        }
        let cancelled = false;
        void (async () => {
            const format = pendingExportFormat;
            const svg = buildSvg(nodes, edges, options);
            if (!svg) {
                if (!cancelled) {
                    setPendingExportFormat(null);
                }
                return;
            }
            const dataUrl = format === 'svg'
                ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
                : await rasterizeSvg(svg);
            if (!dataUrl || cancelled) {
                if (!cancelled) {
                    setPendingExportFormat(null);
                }
                return;
            }
            post({ type: 'exportImage', format, dataUrl } satisfies DvWebviewMessage);
            if (!cancelled) {
                setPendingExportFormat(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [pendingExportFormat, nodes, edges, options]);

    const selectedNode = useMemo(() => selection?.kind === 'node' ? diagramData?.dv.nodes.find(node => node.id === selection.id) ?? null : null, [diagramData, selection]);
    const selectedDevice = useMemo(() => selection?.kind === 'device' ? deviceById(diagramData?.dv ?? { nodes: [], connections: [], version: '', uiFile: '', creatorHash: '', modifierHash: '', unknownXmlAttrs: {} }, selection.id) ?? null : null, [diagramData, selection]);
    const selectedConnection = useMemo(() => selection?.kind === 'connection' ? diagramData?.dv.connections.find(connection => connection.id === selection.id) ?? null : null, [diagramData, selection]);

    const displayedNodes = useMemo(() => {
        if (!focusEnabled || !selection || !diagramData) {
            return nodes;
        }
        const visibleNodeIds = new Set<string>();
        const visibleEdgeIds = new Set<string>();
        if (selection.kind === 'node') {
            visibleNodeIds.add(selection.id);
            const node = diagramData.dv.nodes.find(candidate => candidate.id === selection.id);
            node?.devices.forEach(device => visibleNodeIds.add(device.id));
            for (const connection of diagramData.dv.connections) {
                const { sourceId, targetId } = connectionEndpointsByDeviceId(diagramData.dv, connection);
                if (!sourceId || !targetId) { continue; }
                if (node?.devices.some(device => device.id === sourceId || device.id === targetId)) {
                    visibleEdgeIds.add(connection.id);
                    visibleNodeIds.add(sourceId);
                    visibleNodeIds.add(targetId);
                    const sourceDevice = deviceById(diagramData.dv, sourceId);
                    const targetDevice = deviceById(diagramData.dv, targetId);
                    if (sourceDevice) { visibleNodeIds.add(sourceDevice.nodeId); }
                    if (targetDevice) { visibleNodeIds.add(targetDevice.nodeId); }
                }
            }
        } else if (selection.kind === 'device') {
            const device = deviceById(diagramData.dv, selection.id);
            if (device) {
                visibleNodeIds.add(device.nodeId);
                visibleNodeIds.add(device.device.id);
                for (const connection of diagramData.dv.connections) {
                    const endpoints = connectionEndpointsByDeviceId(diagramData.dv, connection);
                    if (endpoints.sourceId === selection.id || endpoints.targetId === selection.id) {
                        visibleEdgeIds.add(connection.id);
                        if (endpoints.sourceId) { visibleNodeIds.add(endpoints.sourceId); }
                        if (endpoints.targetId) { visibleNodeIds.add(endpoints.targetId); }
                        const sourceDevice = endpoints.sourceId ? deviceById(diagramData.dv, endpoints.sourceId) : undefined;
                        const targetDevice = endpoints.targetId ? deviceById(diagramData.dv, endpoints.targetId) : undefined;
                        if (sourceDevice) { visibleNodeIds.add(sourceDevice.nodeId); }
                        if (targetDevice) { visibleNodeIds.add(targetDevice.nodeId); }
                    }
                }
            }
        } else if (selection.kind === 'connection') {
            const connection = diagramData.dv.connections.find(candidate => candidate.id === selection.id);
            if (connection) {
                visibleEdgeIds.add(connection.id);
                const endpoints = connectionEndpointsByDeviceId(diagramData.dv, connection);
                if (endpoints.sourceId) {
                    visibleNodeIds.add(endpoints.sourceId);
                    const sourceDevice = deviceById(diagramData.dv, endpoints.sourceId);
                    if (sourceDevice) { visibleNodeIds.add(sourceDevice.nodeId); }
                }
                if (endpoints.targetId) {
                    visibleNodeIds.add(endpoints.targetId);
                    const targetDevice = deviceById(diagramData.dv, endpoints.targetId);
                    if (targetDevice) { visibleNodeIds.add(targetDevice.nodeId); }
                }
            }
        }
        return nodes.filter(node => visibleNodeIds.has(node.id));
    }, [diagramData, focusEnabled, nodes, selection]);

    const displayedEdges = useMemo(() => {
        if (!focusEnabled || !selection || !diagramData) {
            return edges;
        }
        const visibleEdgeIds = new Set<string>();
        if (selection.kind === 'connection') {
            visibleEdgeIds.add(selection.id);
        } else if (selection.kind === 'device') {
            for (const connection of diagramData.dv.connections) {
                const endpoints = connectionEndpointsByDeviceId(diagramData.dv, connection);
                if (endpoints.sourceId === selection.id || endpoints.targetId === selection.id) {
                    visibleEdgeIds.add(connection.id);
                }
            }
        } else if (selection.kind === 'node') {
            const node = diagramData.dv.nodes.find(candidate => candidate.id === selection.id);
            const deviceIds = new Set(node?.devices.map(device => device.id) ?? []);
            for (const connection of diagramData.dv.connections) {
                const endpoints = connectionEndpointsByDeviceId(diagramData.dv, connection);
                if ((endpoints.sourceId && deviceIds.has(endpoints.sourceId)) || (endpoints.targetId && deviceIds.has(endpoints.targetId))) {
                    visibleEdgeIds.add(connection.id);
                }
            }
        }
        return edges.filter(edge => visibleEdgeIds.has(edge.id));
    }, [diagramData, edges, focusEnabled, selection]);

    const filteredFunctions = useMemo(() => {
        const all = diagramData?.availableFunctions ?? [];
        const nodeId = selectedNode?.id;
        const filtered = regexFilter(all, functionFilter, fn => `${fn.name} ${fn.path} ${fn.deployedNodeName || ''}`)
            .filter(fn => functionScope === 'all' || (functionScope === 'deployed' ? !!fn.deployedNodeId : !fn.deployedNodeId));
        return [...filtered].sort((left, right) => {
            const leftExact = left.name.toLowerCase() === functionFilter.trim().toLowerCase() ? 1 : 0;
            const rightExact = right.name.toLowerCase() === functionFilter.trim().toLowerCase() ? 1 : 0;
            if (leftExact !== rightExact) { return rightExact - leftExact; }
            const leftPriority = left.deployedNodeId === nodeId ? 2 : left.deployedNodeId ? 1 : 0;
            const rightPriority = right.deployedNodeId === nodeId ? 2 : right.deployedNodeId ? 1 : 0;
            if (leftPriority !== rightPriority) { return leftPriority - rightPriority; }
            return left.name.localeCompare(right.name);
        });
    }, [diagramData, functionFilter, functionScope, selectedNode?.id]);

    const filteredMessages = useMemo(() => {
        const all = diagramData?.availableMessages ?? [];
        const connectionId = selectedConnection?.id;
        const filtered = regexFilter(all, messageFilter, message => `${message.name} ${message.fromFunction} ${message.fromInterface} ${message.toFunction} ${message.toInterface}`)
            .filter(message => messageScope === 'all' || (messageScope === 'deployed' ? !!message.deployedConnectionId : !message.deployedConnectionId));
        return [...filtered].sort((left, right) => {
            const leftExact = left.name.toLowerCase() === messageFilter.trim().toLowerCase() ? 1 : 0;
            const rightExact = right.name.toLowerCase() === messageFilter.trim().toLowerCase() ? 1 : 0;
            if (leftExact !== rightExact) { return rightExact - leftExact; }
            const leftPriority = left.deployedConnectionId === connectionId ? 2 : left.deployedConnectionId ? 1 : 0;
            const rightPriority = right.deployedConnectionId === connectionId ? 2 : right.deployedConnectionId ? 1 : 0;
            if (leftPriority !== rightPriority) { return leftPriority - rightPriority; }
            return left.name.localeCompare(right.name);
        });
    }, [diagramData, messageFilter, messageScope, selectedConnection?.id]);

    const onConnect: OnConnect = connection => {
        if (locked || !connection.source || !connection.target || connection.source === connection.target || !diagramData) {
            return;
        }
        const source = deviceById(diagramData.dv, connection.source);
        const target = deviceById(diagramData.dv, connection.target);
        if (!source || !target) {
            return;
        }
        post({
            type: 'connectDvDevices',
            id: uuid(),
            fromNodeId: source.nodeId,
            fromDeviceId: source.device.id,
            toNodeId: target.nodeId,
            toDeviceId: target.device.id,
        } satisfies DvWebviewMessage);
    };

    const onNodeDragStop: NodeDragHandler = (_event, node) => {
        if (locked) {
            return;
        }
        if (node.type === 'dvNode') {
            post({ type: 'nodesMoved', moves: [{ id: node.id, kind: 'node', x: node.position.x, y: node.position.y, w: Number(node.width ?? node.style?.width ?? DV_NODE_WIDTH), h: Number(node.height ?? node.style?.height ?? DV_NODE_HEIGHT) }] } satisfies DvWebviewMessage);
            return;
        }
        if (node.type === 'dvDevice' && node.parentId) {
            const parent = nodes.find(candidate => candidate.id === node.parentId);
            const parentWidth = Number(parent?.width ?? parent?.style?.width ?? DV_NODE_WIDTH);
            const parentHeight = Number(parent?.height ?? parent?.style?.height ?? DV_NODE_HEIGHT);
            const snapped = snapDeviceToEdge(node.position.x, node.position.y, parentWidth, parentHeight);
            setNodes(existing => existing.map(candidate => candidate.id === node.id ? { ...candidate, position: { x: snapped.x, y: snapped.y }, data: { ...(candidate.data as object), edge: snapped.edge } } : candidate));
            post({ type: 'nodesMoved', moves: [{ id: node.id, kind: 'device', parentId: node.parentId, x: snapped.x, y: snapped.y, w: DV_DEVICE_WIDTH, h: DV_DEVICE_HEIGHT }] } satisfies DvWebviewMessage);
        }
    };

    const updateOptions = (patch: Partial<EditorOptions>) => {
        const next = { ...options, ...patch };
        setOptions(next);
        post({ type: 'updateOptions', options: next } satisfies DvWebviewMessage);
    };

    const handlePaneContext = (event: React.MouseEvent) => {
        event.preventDefault();
        setPendingAddPosition(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        const items: ContextMenuItem[] = [
            { label: 'Search Node', onClick: () => setSearchNodeOpen(true) },
            { label: 'Add Node', onClick: () => setBoardPickerOpen(true) },
        ];
        if (capabilities.canBuild) {
            items.push({
                label: 'Build',
                children: [
                    { label: 'Clean', onClick: () => post({ type: 'buildDv', mode: 'clean' } satisfies DvWebviewMessage) },
                    { label: 'Build Debug', onClick: () => post({ type: 'buildDv', mode: 'debug' } satisfies DvWebviewMessage) },
                    { label: 'Build Release', onClick: () => post({ type: 'buildDv', mode: 'release' } satisfies DvWebviewMessage) },
                    { label: 'Build Skeletons', onClick: () => post({ type: 'buildDv', mode: 'skeletons' } satisfies DvWebviewMessage) },
                ],
            });
        }
        items.push({ label: 'Export Diagram as Image', onClick: () => post({ type: 'requestExport' } satisfies DvWebviewMessage) });
        setContextMenu({
            x: event.clientX,
            y: event.clientY,
            items,
        });
    };

    const handleNodeContext = (event: React.MouseEvent, node: Node) => {
        event.preventDefault();
        if (node.type === 'dvNode') {
            setSelection({ kind: 'node', id: node.id });
            setContextMenu({
                x: event.clientX,
                y: event.clientY,
                items: [
                    { label: 'Edit Node', onClick: () => setSelection({ kind: 'node', id: node.id }) },
                    { label: 'Delete Node', danger: true, onClick: () => post({ type: 'deleteDvEntities', nodeIds: [node.id] } satisfies DvWebviewMessage) },
                ],
            });
            return;
        }
        setSelection({ kind: 'device', id: node.id });
        setContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
                { label: 'Edit Device', onClick: () => setSelection({ kind: 'device', id: node.id }) },
                { label: 'Delete Device', danger: true, onClick: () => post({ type: 'deleteDvEntities', deviceIds: [node.id] } satisfies DvWebviewMessage) },
            ],
        });
    };

    const handleEdgeContext = (event: React.MouseEvent, edge: Edge) => {
        event.preventDefault();
        setSelection({ kind: 'connection', id: edge.id });
        setContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
                { label: 'Edit Connection', onClick: () => setSelection({ kind: 'connection', id: edge.id }) },
                { label: 'Remove Connection', danger: true, onClick: () => post({ type: 'deleteDvEntities', connectionIds: [edge.id] } satisfies DvWebviewMessage) },
            ],
        });
    };

    const selectedFunctionIds = new Set(checkedFunctionIds);
    const selectedMessageKeySet = new Set(checkedMessageKeys);
    const panelVisible = optionsVisible || !!selection;

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative', background: options.canvasColor }}>
            <BoardPickerDialog
                boards={diagramData?.boards.boards ?? []}
                open={boardPickerOpen}
                onCancel={() => setBoardPickerOpen(false)}
                onConfirm={board => {
                    const position = pendingAddPosition ?? reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                    post({ type: 'addDvNode', id: uuid(), boardType: board.type, boardName: board.name, rfX: position.x, rfY: position.y } satisfies DvWebviewMessage);
                    setBoardPickerOpen(false);
                }}
            />
            <SearchNodeDialog
                open={searchNodeOpen}
                nodes={diagramData?.dv.nodes ?? []}
                onCancel={() => setSearchNodeOpen(false)}
                onSelect={nodeId => {
                    const node = nodes.find(candidate => candidate.id === nodeId);
                    if (node) {
                        reactFlow.setCenter(node.position.x + Number(node.width ?? DV_NODE_WIDTH) / 2, node.position.y + Number(node.height ?? DV_NODE_HEIGHT) / 2, { zoom: Math.max(reactFlow.getZoom(), 0.8), duration: 300 });
                    }
                    setSelection({ kind: 'node', id: nodeId });
                    setSearchNodeOpen(false);
                }}
            />
            <DvPalette
                snapEnabled={options.snapEnabled}
                focusEnabled={focusEnabled}
                locked={locked}
                optionsVisible={optionsVisible}
                onZoomIn={() => void reactFlow.zoomIn()}
                onZoomOut={() => void reactFlow.zoomOut()}
                onFitView={() => void reactFlow.fitView({ padding: 0.12, duration: 200 })}
                onToggleSnap={() => updateOptions({ snapEnabled: !options.snapEnabled })}
                onToggleFocus={() => setFocusEnabled(value => !value)}
                onAddNode={() => setBoardPickerOpen(true)}
                onSearchNode={() => setSearchNodeOpen(true)}
                onExportImage={() => post({ type: 'requestExport' } satisfies DvWebviewMessage)}
                onShowOptions={() => setOptionsVisible(value => !value)}
                onToggleLock={() => setLocked(value => !value)}
            />

            {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}

            {panelVisible && <div style={PANEL_STYLE}>
                {optionsVisible && !selection && (
                    <div>
                        <div style={SECTION_TITLE}>Options</div>
                        <div style={ROW}>
                            <span style={LABEL}>Boards File</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <input style={{ ...INPUT, flex: 1 }} value={options.boardsFilePath} onChange={event => updateOptions({ boardsFilePath: event.target.value })} />
                                <button style={BTN} disabled={!capabilities.canBrowseBoardsFile} onClick={() => post({ type: 'browseBoardsFile' } satisfies DvWebviewMessage)}>…</button>
                            </div>
                        </div>
                        <div style={ROW}><span style={LABEL}>Canvas Color</span><input style={INPUT} value={options.canvasColor} onChange={event => updateOptions({ canvasColor: event.target.value })} /></div>
                        <div style={ROW}><span style={LABEL}>Show Minimap</span><label><input type="checkbox" checked={options.showMinimap} onChange={event => updateOptions({ showMinimap: event.target.checked })} /> Enabled</label></div>
                        <div style={ROW}><span style={LABEL}>Show Device Names</span><label><input type="checkbox" checked={options.showDeviceNames} onChange={event => updateOptions({ showDeviceNames: event.target.checked })} /> Enabled</label></div>
                        <div style={ROW}><span style={LABEL}>Show Connection Labels</span><label><input type="checkbox" checked={options.showConnectionLabels} onChange={event => updateOptions({ showConnectionLabels: event.target.checked })} /> Enabled</label></div>
                        <div style={ROW}>
                            <span style={LABEL}>Use taste-cli.sh for Commands</span>
                            <label><input type="checkbox" checked={options.useTasteCliShForCommands} onChange={event => updateOptions({ useTasteCliShForCommands: event.target.checked })} /> Run Build commands through taste-cli.sh</label>
                        </div>
                        <div style={ROW}><span style={LABEL}>Node Font Size</span><input style={INPUT} type="number" value={options.fontSizeFn} onChange={event => updateOptions({ fontSizeFn: Math.max(20, Number(event.target.value) || 90) })} /></div>
                        <div style={ROW}><span style={LABEL}>Device Font Size</span><input style={INPUT} type="number" value={options.fontSizeIface} onChange={event => updateOptions({ fontSizeIface: Math.max(8, Number(event.target.value) || 45) })} /></div>
                        <div style={ROW}><span style={LABEL}>Connection Font Size</span><input style={INPUT} type="number" value={options.fontSizeConn} onChange={event => updateOptions({ fontSizeConn: Math.max(6, Number(event.target.value) || 11) })} /></div>
                    </div>
                )}

                {selectedNode && (
                    <div>
                        <div style={SECTION_TITLE}>Node</div>
                        <div style={ROW}><span style={LABEL}>Node Label</span><input style={INPUT} value={selectedNode.nodeLabel} onChange={event => post({ type: 'updateDvNode', id: selectedNode.id, nodeLabel: event.target.value } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Partition Name</span><input style={INPUT} value={selectedNode.partition.name} onChange={event => post({ type: 'updateDvNode', id: selectedNode.id, partitionName: event.target.value } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Node</span><input style={INPUT} value={selectedNode.name} onChange={event => post({ type: 'updateDvNode', id: selectedNode.id, name: event.target.value } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Board Type</span><input style={INPUT} value={selectedNode.type} readOnly /></div>
                        <div style={ROW}><span style={LABEL}>Namespace</span><input style={INPUT} value={selectedNode.namespace} readOnly /></div>
                        <div style={SECTION_TITLE}>Devices</div>
                        <div style={LIST}>
                            {selectedNode.devices.map(device => (
                                <button key={device.id} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', color: '#cdd6f4', border: 'none', padding: '8px 10px', borderBottom: '1px solid #313244', cursor: 'pointer' }} onClick={() => setSelection({ kind: 'device', id: device.id })}>
                                    {device.name} ({device.port || '-'})
                                </button>
                            ))}
                        </div>

                        <div style={{ ...SECTION_TITLE, marginTop: 12 }}>Partition Functions</div>
                        <div style={ROW}><input style={INPUT} placeholder="Filter functions" value={functionFilter} onChange={event => setFunctionFilter(event.target.value)} /></div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            {(['all', 'undeployed', 'deployed'] as const).map(scope => <button key={scope} style={functionScope === scope ? BTN_PRIMARY : BTN} onClick={() => setFunctionScope(scope)}>{scope}</button>)}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            <button style={BTN_PRIMARY} disabled={checkedFunctionIds.length === 0} onClick={() => post({ type: 'deployDvFunctions', nodeId: selectedNode.id, functionIds: checkedFunctionIds } satisfies DvWebviewMessage)}>Deploy / Move Selected</button>
                            <button style={BTN} disabled={checkedFunctionIds.length === 0} onClick={() => post({ type: 'undeployDvFunctions', nodeId: selectedNode.id, functionIds: checkedFunctionIds } satisfies DvWebviewMessage)}>Undeploy Selected</button>
                        </div>
                        <div style={LIST}>
                            {filteredFunctions.map(item => {
                                const isOnThisNode = item.deployedNodeId === selectedNode.id;
                                const isElsewhere = !!item.deployedNodeId && !isOnThisNode;
                                return (
                                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #313244' }}>
                                        <input type="checkbox" checked={selectedFunctionIds.has(item.id)} onChange={event => setCheckedFunctionIds(current => event.target.checked ? [...current, item.id] : current.filter(value => value !== item.id))} />
                                        <div>
                                            <div style={{ color: '#cdd6f4' }}>{item.name}</div>
                                            <div style={{ color: '#a6adc8', fontSize: 10 }}>{isOnThisNode ? 'Deployed here' : isElsewhere ? `Deployed on ${item.deployedNodeName}` : 'Undeployed'}</div>
                                        </div>
                                        <button style={isOnThisNode ? BTN : BTN_PRIMARY} onClick={() => post({ type: isOnThisNode ? 'undeployDvFunctions' : 'deployDvFunctions', nodeId: selectedNode.id, functionIds: [item.id] } satisfies DvWebviewMessage)}>{isOnThisNode ? 'Undeploy' : isElsewhere ? 'Move' : 'Deploy'}</button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {selectedDevice && (
                    <div>
                        <div style={SECTION_TITLE}>Device</div>
                        <div style={ROW}><span style={LABEL}>Node</span><input style={INPUT} value={selectedDevice.nodeName} readOnly /></div>
                        <div style={ROW}><span style={LABEL}>Name</span><input style={INPUT} value={selectedDevice.device.name} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { name: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Port</span><input style={INPUT} value={selectedDevice.device.port} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { port: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Requires Bus Access</span><input style={INPUT} value={selectedDevice.device.requiresBusAccess} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { requiresBusAccess: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Packetizer</span><input style={INPUT} value={selectedDevice.device.packetizer} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { packetizer: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Config</span><textarea style={{ ...INPUT, minHeight: 70 }} value={selectedDevice.device.config} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { config: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>ASN.1 File</span><input style={INPUT} value={selectedDevice.device.asn1file} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { asn1file: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>ASN.1 Module</span><input style={INPUT} value={selectedDevice.device.asn1module} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { asn1module: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>ASN.1 Type</span><input style={INPUT} value={selectedDevice.device.asn1type} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { asn1type: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Extends</span><input style={INPUT} value={selectedDevice.device.extends} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { extends: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Impl Extends</span><input style={INPUT} value={selectedDevice.device.implExtends} onChange={event => post({ type: 'updateDvDevice', nodeId: selectedDevice.nodeId, id: selectedDevice.device.id, patch: { implExtends: event.target.value } } satisfies DvWebviewMessage)} /></div>
                    </div>
                )}

                {selectedConnection && (
                    <div>
                        <div style={SECTION_TITLE}>Connection</div>
                        <div style={ROW}><span style={LABEL}>Name</span><input style={INPUT} value={selectedConnection.name} onChange={event => post({ type: 'updateDvConnection', id: selectedConnection.id, patch: { name: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={ROW}><span style={LABEL}>Source</span><input style={INPUT} value={`${selectedConnection.fromNode}:${selectedConnection.fromPort}`} readOnly /></div>
                        <div style={ROW}><span style={LABEL}>Destination</span><input style={INPUT} value={`${selectedConnection.toNode}:${selectedConnection.toPort}`} readOnly /></div>
                        <div style={ROW}><span style={LABEL}>Bus</span><input style={INPUT} value={selectedConnection.toBus} onChange={event => post({ type: 'updateDvConnection', id: selectedConnection.id, patch: { toBus: event.target.value } } satisfies DvWebviewMessage)} /></div>
                        <div style={{ ...SECTION_TITLE, marginTop: 12 }}>Messages</div>
                        <div style={ROW}><input style={INPUT} placeholder="Filter messages" value={messageFilter} onChange={event => setMessageFilter(event.target.value)} /></div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            {(['all', 'undeployed', 'deployed'] as const).map(scope => <button key={scope} style={messageScope === scope ? BTN_PRIMARY : BTN} onClick={() => setMessageScope(scope)}>{scope}</button>)}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            <button style={BTN_PRIMARY} disabled={checkedMessageKeys.length === 0} onClick={() => post({ type: 'deployDvMessages', connectionId: selectedConnection.id, messageIds: checkedMessageKeys } satisfies DvWebviewMessage)}>Deploy / Move Selected</button>
                            <button style={BTN} disabled={checkedMessageKeys.length === 0} onClick={() => post({ type: 'undeployDvMessages', connectionId: selectedConnection.id, messageIds: checkedMessageKeys } satisfies DvWebviewMessage)}>Undeploy Selected</button>
                        </div>
                        <div style={LIST}>
                            {filteredMessages.map(item => {
                                const isOnThisConnection = item.deployedConnectionId === selectedConnection.id;
                                const isElsewhere = !!item.deployedConnectionId && !isOnThisConnection;
                                return (
                                    <div key={item.key} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #313244' }}>
                                        <input type="checkbox" checked={selectedMessageKeySet.has(item.key)} onChange={event => setCheckedMessageKeys(current => event.target.checked ? [...current, item.key] : current.filter(value => value !== item.key))} />
                                        <div>
                                            <div style={{ color: '#cdd6f4' }}>{item.name || `${item.fromFunction}.${item.fromInterface} -> ${item.toFunction}.${item.toInterface}`}</div>
                                            <div style={{ color: '#a6adc8', fontSize: 10 }}>{isOnThisConnection ? 'Deployed here' : isElsewhere ? `Deployed on ${item.deployedConnectionName}` : 'Undeployed'}</div>
                                        </div>
                                        <button style={isOnThisConnection ? BTN : BTN_PRIMARY} onClick={() => post({ type: isOnThisConnection ? 'undeployDvMessages' : 'deployDvMessages', connectionId: selectedConnection.id, messageIds: [item.key] } satisfies DvWebviewMessage)}>{isOnThisConnection ? 'Undeploy' : isElsewhere ? 'Move' : 'Deploy'}</button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>}

            {waiting && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#cdd6f4' }}>Loading Deployment View…</div>}
            {loadError && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#f38ba8' }}>{loadError}</div>}

            <ReactFlow
                nodes={displayedNodes}
                edges={displayedEdges.map(edge => ({
                    ...edge,
                    label: options.showConnectionLabels ? edge.label : '',
                    labelStyle: { fontSize: Math.max(6, options.fontSizeConn) },
                }))}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                onPaneClick={() => { setSelection(null); setContextMenu(null); }}
                onPaneContextMenu={handlePaneContext}
                onNodeClick={(_event, node) => setSelection({ kind: node.type === 'dvNode' ? 'node' : 'device', id: node.id })}
                onNodeContextMenu={handleNodeContext}
                onEdgeClick={(_event, edge) => setSelection({ kind: 'connection', id: edge.id })}
                onEdgeContextMenu={handleEdgeContext}
                nodeTypes={nodeTypes}
                fitView
                snapToGrid={options.snapEnabled}
                snapGrid={[options.snapGridSize, options.snapGridSize]}
                nodesDraggable={!locked}
                nodesConnectable={!locked}
                elementsSelectable
                deleteKeyCode={null}
                style={{ background: options.canvasColor }}
                fitViewOptions={{ padding: 0.12, includeHiddenNodes: true }}
                minZoom={0.001}
                maxZoom={6}
            >
                <Background color="#313244" gap={options.snapGridSize} />
                <Controls showInteractive={false} />
                {options.showMinimap && <MiniMap pannable zoomable position="top-right" style={{ background: '#181825' }} />}
            </ReactFlow>
        </div>
    );
}

function resolveSelection(model: DvModel, selection: Selection): boolean {
    if (!selection) {
        return true;
    }
    if (selection.kind === 'node') {
        return model.nodes.some(node => node.id === selection.id);
    }
    if (selection.kind === 'device') {
        return !!deviceById(model, selection.id);
    }
    return model.connections.some(connection => connection.id === selection.id);
}

function buildSvg(nodes: Node[], edges: Edge[], options: EditorOptions): string | null {
    if (nodes.length === 0) {
        return null;
    }
    const rootNodes = nodes.filter(node => !node.parentId);
    if (rootNodes.length === 0) {
        return null;
    }
    const bounds = rootNodes.reduce((acc, node) => {
        const width = Number(node.width ?? node.style?.width ?? DV_NODE_WIDTH);
        const height = Number(node.height ?? node.style?.height ?? DV_NODE_HEIGHT);
        return {
            minX: Math.min(acc.minX, node.position.x),
            minY: Math.min(acc.minY, node.position.y),
            maxX: Math.max(acc.maxX, node.position.x + width),
            maxY: Math.max(acc.maxY, node.position.y + height),
        };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const pad = 40;
    const width = Math.max(bounds.maxX - bounds.minX + pad * 2, 400);
    const height = Math.max(bounds.maxY - bounds.minY + pad * 2, 280);
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const absolutePos = (node: Node): { x: number; y: number } => {
        if (!node.parentId) {
            return { x: node.position.x + pad - bounds.minX, y: node.position.y + pad - bounds.minY };
        }
        const parent = nodeMap.get(node.parentId);
        const parentPosition = parent ? absolutePos(parent) : { x: pad, y: pad };
        return { x: parentPosition.x + node.position.x, y: parentPosition.y + node.position.y };
    };

    const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, `<rect width="100%" height="100%" fill="${options.canvasColor}"/>`];
    for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) { continue; }
        const sourcePosition = absolutePos(source);
        const targetPosition = absolutePos(target);
        const sx = sourcePosition.x + DV_DEVICE_WIDTH;
        const sy = sourcePosition.y + DV_DEVICE_HEIGHT / 2;
        const tx = targetPosition.x;
        const ty = targetPosition.y + DV_DEVICE_HEIGHT / 2;
        parts.push(`<path d="M${sx},${sy} C${sx + 60},${sy} ${tx - 60},${ty} ${tx},${ty}" stroke="#89b4fa" stroke-width="2" fill="none"/>`);
        if (options.showConnectionLabels && edge.label) {
            parts.push(`<text x="${(sx + tx) / 2}" y="${(sy + ty) / 2 - 6}" text-anchor="middle" fill="#a6adc8" font-size="${Math.max(6, options.fontSizeConn)}" font-family="sans-serif">${escapeXml(String(edge.label))}</text>`);
        }
    }
    for (const node of nodes) {
        const pos = absolutePos(node);
        if (node.type === 'dvNode') {
            const widthPx = Number(node.width ?? node.style?.width ?? DV_NODE_WIDTH);
            const heightPx = Number(node.height ?? node.style?.height ?? DV_NODE_HEIGHT);
            const data = node.data as { node: DvNodeModel; summary: string; overflow: number; headerFontSize?: number; bodyFontSize?: number };
            const headerFontSize = data.headerFontSize ?? DV_NODE_HEADER_FONT_SIZE;
            const bodyFontSize = data.bodyFontSize ?? DV_NODE_BODY_FONT_SIZE;
            parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${widthPx}" height="${heightPx}" rx="8" fill="#1e1e2e" stroke="#6c7086" stroke-width="2"/>`);
            parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${widthPx}" height="34" rx="8" fill="#313244"/>`);
            parts.push(`<text x="${pos.x + 10}" y="${pos.y + 22}" fill="#cdd6f4" font-size="${headerFontSize}" font-family="sans-serif">${escapeXml(`${data.node.name} [${data.node.type || data.node.namespace || 'Board'}]`)}</text>`);
            parts.push(`<text x="${pos.x + 10}" y="${pos.y + 56}" fill="#a6adc8" font-size="${bodyFontSize}" font-family="sans-serif">Functions: ${data.node.partition.functions.length}</text>`);
        } else {
            const data = node.data as { device: DvDeviceModel; showName?: boolean; fontSizeDevice?: number };
            parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${DV_DEVICE_WIDTH}" height="${DV_DEVICE_HEIGHT}" rx="14" fill="#313244" stroke="#6c7086" stroke-width="1"/>`);
            parts.push(`<text x="${pos.x + 8}" y="${pos.y + 18}" fill="#cdd6f4" font-size="${data.fontSizeDevice ?? DV_DEVICE_FONT_SIZE}" font-family="sans-serif">${escapeXml(data.showName === false ? data.device.port || data.device.name : data.device.name)}</text>`);
        }
    }
    parts.push('</svg>');
    return parts.join('\n');
}

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rasterizeSvg(svg: string): Promise<string | null> {
    return new Promise(resolve => {
        const image = new Image();
        const canvas = document.createElement('canvas');
        const match = /width="(\d+)" height="(\d+)"/u.exec(svg);
        const width = Number(match?.[1] ?? 800);
        const height = Number(match?.[2] ?? 600);
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
            resolve(null);
            return;
        }
        image.onload = () => {
            context.drawImage(image, 0, 0, width, height);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => resolve(null);
        image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    });
}

export default function DvApp() {
    return (
        <ReactFlowProvider>
            <DvDiagramEditor />
        </ReactFlowProvider>
    );
}