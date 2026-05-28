import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Edge,
    Handle,
    MiniMap,
    Node,
    NodeChange,
    NodeDragHandler,
    NodeMouseHandler,
    NodeProps,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
    DEFAULT_OPTIONS,
    EditorOptions,
    SdlExtensionMessage,
    SdlModel,
    SdlSymbol,
    SdlSymbolKind,
    SdlWebviewMessage,
} from '../../src/model/types';
import { post } from './vscodeApi';
import { buildSdlGraph, SDL_SYMBOL_NODE, SdlNodeData, sdlFillColor } from './sdlTransform';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';

// ── Style helpers ────────────────────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
    background: '#1e1e2e', color: '#cdd6f4', border: '1px solid #45475a',
    borderRadius: 3, padding: '2px 4px', fontSize: 11,
    fontFamily: 'monospace', width: '100%', boxSizing: 'border-box',
};
const ROW: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0',
    borderBottom: '1px solid #313244',
};
const LABEL: React.CSSProperties = { color: '#a6adc8', fontSize: 11 };
const TEXTAREA_STYLE: React.CSSProperties = {
    ...INPUT_BASE, resize: 'vertical', minHeight: 60,
};
const SEP: React.CSSProperties = { borderTop: '1px solid #313244', margin: '10px 0' };
const PANEL_STYLE: React.CSSProperties = {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 280,
    background: '#181825', borderLeft: '1px solid #313244', padding: 10,
    overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, zIndex: 15,
};

// ── SVG shape helpers ────────────────────────────────────────────────────────

interface ShapeProps { w: number; h: number; fill: string; stroke: string; strokeWidth: number; }

function PillShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const rx = Math.min(h / 2, w / 2);
    return <rect x={strokeWidth / 2} y={strokeWidth / 2} width={w - strokeWidth} height={h - strokeWidth} rx={rx} ry={rx} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function RectShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const pad = strokeWidth / 2;
    return <rect x={pad} y={pad} width={w - strokeWidth} height={h - strokeWidth} rx={4} ry={4} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function RoundedRectShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const pad = strokeWidth / 2;
    const rx = Math.min(h / 4, w / 4);
    return <rect x={pad} y={pad} width={w - strokeWidth} height={h - strokeWidth} rx={rx} ry={rx} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function DoubleRectShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const pad = strokeWidth / 2;
    const inner = 4;
    return (
        <g>
            <rect x={pad} y={pad} width={w - strokeWidth} height={h - strokeWidth} rx={2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
            <line x1={inner + pad} y1={pad} x2={inner + pad} y2={h - pad} stroke={stroke} strokeWidth={strokeWidth} />
            <line x1={w - inner - pad} y1={pad} x2={w - inner - pad} y2={h - pad} stroke={stroke} strokeWidth={strokeWidth} />
        </g>
    );
}

function DiamondShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const cx = w / 2, cy = h / 2;
    const points = `${cx},${strokeWidth / 2} ${w - strokeWidth / 2},${cy} ${cx},${h - strokeWidth / 2} ${strokeWidth / 2},${cy}`;
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function StepCutRectShape({ w, h, fill, stroke, strokeWidth, cut = 10 }: ShapeProps & { cut?: number }): React.ReactElement {
    const pad = strokeWidth / 2;
    const points = `${pad + cut},${pad} ${w - pad},${pad} ${w - pad},${h - pad} ${pad},${h - pad} ${pad},${pad + cut}`;
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function DogEarShape({ w, h, fill, stroke, strokeWidth, corner = 12 }: ShapeProps & { corner?: number }): React.ReactElement {
    const pad = strokeWidth / 2;
    const points = `${pad},${pad} ${w - pad - corner},${pad} ${w - pad},${pad + corner} ${w - pad},${h - pad} ${pad},${h - pad}`;
    return (
        <g>
            <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
            <polyline points={`${w - pad - corner},${pad} ${w - pad - corner},${pad + corner} ${w - pad},${pad + corner}`} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
        </g>
    );
}

function DashedRectShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const pad = strokeWidth / 2;
    return <rect x={pad} y={pad} width={w - strokeWidth} height={h - strokeWidth} rx={3} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray="6 3" />;
}

function CircleShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - strokeWidth / 2;
    return <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function DoubleCircleShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const cx = w / 2, cy = h / 2;
    const r1 = Math.min(w, h) / 2 - strokeWidth / 2;
    const r2 = r1 * 0.7;
    return (
        <g>
            <circle cx={cx} cy={cy} r={r1} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
            <circle cx={cx} cy={cy} r={r2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        </g>
    );
}

function renderShape(kind: SdlSymbolKind, w: number, h: number, fill: string, stroke: string, sw: number): React.ReactElement {
    const props: ShapeProps = { w, h, fill, stroke, strokeWidth: sw };
    switch (kind) {
        case 'start':
        case 'nextstate':
        case 'return':         return <PillShape {...props} />;
        case 'state':          return <RoundedRectShape {...props} />;
        case 'stateAggregation': return <DoubleRectShape {...props} />;
        case 'input':
        case 'continuousSignal':
        case 'output':         return <StepCutRectShape {...props} />;
        case 'task':           return <RectShape {...props} />;
        case 'decision':
        case 'alternative':    return <DiamondShape {...props} />;
        case 'answer':         return <RectShape {...props} />;
        case 'procedure':
        case 'procedureCall':  return <DoubleRectShape {...props} />;
        case 'join':           return <CircleShape {...props} />;
        case 'label':          return <CircleShape {...props} />;
        case 'connect':        return <DoubleCircleShape {...props} />;
        case 'comment':        return <DogEarShape {...props} />;
        case 'textArea':       return <DashedRectShape {...props} />;
        default:               return <RectShape {...props} />;
    }
}

// ── Custom SDL node ───────────────────────────────────────────────────────────

const HANDLE_STYLE: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };

function SdlSymbolNode({ data, width, height, selected }: NodeProps<Node<SdlNodeData>>): React.ReactElement {
    const { kind, text, options, hasChildren } = data;
    const w = width ?? 150;
    const h = height ?? 60;
    const fill   = sdlFillColor(kind, options);
    const stroke = selected ? '#cba6f7' : options.sdlDefaultBorderColor;
    const sw     = selected ? 2 : options.sdlConnectionThickness;
    const isTextArea = kind === 'textArea';
    const displayText = isTextArea
        ? text.split('\n').filter(line => !/^\s*\/\*\s*CIF\b/.test(line)).join('\n').trim()
        : text.length > 80 ? text.slice(0, 77) + '…' : text;

    return (
        <div style={{ width: w, height: h, position: 'relative', background: 'transparent' }}>
            {/* Invisible handles so ReactFlow can draw edges */}
            <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
            <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
                {renderShape(kind, w, h, fill, stroke, sw)}
                <foreignObject x={sw + 2} y={sw + 2} width={w - sw * 2 - 4} height={h - sw * 2 - 4}>
                    <div
                        style={{
                            width: '100%', height: '100%',
                            display: 'flex',
                            alignItems: isTextArea ? 'flex-start' : 'center',
                            justifyContent: isTextArea ? 'flex-start' : 'center',
                            overflow: 'hidden', color: options.sdlDefaultTextColor,
                            fontSize: options.sdlFontSize, fontFamily: 'monospace',
                            padding: '2px 4px', boxSizing: 'border-box',
                            wordBreak: 'break-all',
                            textAlign: isTextArea ? 'left' : 'center',
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {displayText}
                        {hasChildren && (
                            <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.6 }}>▶</span>
                        )}
                    </div>
                </foreignObject>
            </svg>
            <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
        </div>
    );
}

const NODE_TYPES = { [SDL_SYMBOL_NODE]: SdlSymbolNode };

// ── Left palette (zoom/fit/export/options/lock) ──────────────────────────────

interface SdlPaletteProps {
    locked: boolean;
    showOptions: boolean;
    onToggleLock: () => void;
    onToggleOptions: () => void;
    onExport: () => void;
}

function SdlPalette({ locked, showOptions, onToggleLock, onToggleOptions, onExport }: SdlPaletteProps): React.ReactElement {
    const { zoomIn, zoomOut, fitView } = useReactFlow();

    const btnStyle = (active = false): React.CSSProperties => ({
        width: 36, height: 36, border: 'none', borderRadius: 6,
        background: active ? '#45475a' : 'transparent',
        color: active ? '#89b4fa' : '#cdd6f4',
        cursor: 'pointer', fontSize: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    return (
        <div style={{
            position: 'absolute', left: 0, top: 0,
            display: 'inline-flex', flexDirection: 'column', gap: 4, padding: '8px 4px',
            background: '#181825', borderRight: '1px solid #313244',
            borderBottom: '1px solid #313244', borderBottomRightRadius: 6, zIndex: 20,
        }}>
            <button style={btnStyle()} title="Zoom in" onClick={() => zoomIn()}>+</button>
            <button style={btnStyle()} title="Zoom out" onClick={() => zoomOut()}>−</button>
            <button style={{ ...btnStyle(), fontSize: 14 }} title="Fit view" onClick={() => fitView({ padding: 0.1 })}>⊡</button>
            <div style={{ borderTop: '1px solid #313244', margin: '4px 0' }} />
            <button style={btnStyle()} title="Export image" onClick={onExport}>⬇</button>
            <div style={{ borderTop: '1px solid #313244', margin: '4px 0' }} />
            <button style={btnStyle(showOptions)} title="Options" onClick={onToggleOptions}>⚙</button>
            <button style={btnStyle(locked)} title={locked ? 'Unlock layout' : 'Lock layout'} onClick={onToggleLock}>
                {locked ? '🔒' : '🔓'}
            </button>
        </div>
    );
}

// ── Breadcrumb navigation ────────────────────────────────────────────────────

interface BreadcrumbProps {
    levelPath: SdlSymbol[];
    onNavigateTo: (index: number) => void;  // -1 = process root
}

function SdlBreadcrumb({ levelPath, onNavigateTo }: BreadcrumbProps): React.ReactElement | null {
    if (levelPath.length === 0) return null;
    return (
        <div style={{
            position: 'absolute', left: 44, right: 0, top: 0, height: 28,
            background: '#11111b', borderBottom: '1px solid #313244',
            display: 'flex', alignItems: 'center', padding: '0 8px',
            fontFamily: 'monospace', fontSize: 11, zIndex: 15, gap: 4,
        }}>
            <span
                style={{ color: '#89b4fa', cursor: 'pointer' }}
                onClick={() => onNavigateTo(-1)}
            >Process</span>
            {levelPath.map((sym, i) => (
                <React.Fragment key={sym.id}>
                    <span style={{ color: '#6c7086' }}>›</span>
                    <span
                        style={{ color: i === levelPath.length - 1 ? '#cdd6f4' : '#89b4fa', cursor: i < levelPath.length - 1 ? 'pointer' : 'default' }}
                        onClick={() => { if (i < levelPath.length - 1) onNavigateTo(i); }}
                    >
                        {sym.kind}: {sym.text.slice(0, 30) || '(empty)'}
                    </span>
                </React.Fragment>
            ))}
        </div>
    );
}

// ── Options panel ────────────────────────────────────────────────────────────

interface OptionsPanelProps {
    options: EditorOptions;
    onChange: (patch: Partial<EditorOptions>) => void;
    onClose: () => void;
}

function ColorInputRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): React.ReactElement {
    return (
        <div style={ROW}>
            <span style={LABEL}>{label}</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                    type="color"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    style={{ width: 36, height: 24, padding: 0, border: 'none', cursor: 'pointer', background: 'none' }}
                />
                <input
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    style={{ ...INPUT_BASE, flex: 1 }}
                />
            </div>
        </div>
    );
}

function SdlOptionsPanel({ options, onChange, onClose }: OptionsPanelProps): React.ReactElement {
    return (
        <div style={{ ...PANEL_STYLE, width: 300 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#cba6f7', fontWeight: 'bold' }}>SDL Options</span>
                <button
                    style={{ background: 'none', border: 'none', color: '#cdd6f4', cursor: 'pointer', fontSize: 14 }}
                    onClick={onClose}
                >✕</button>
            </div>

            <div style={ROW}>
                <span style={LABEL}>Font size (px)</span>
                <input type="number" min={8} max={24} value={options.sdlFontSize}
                    onChange={e => onChange({ sdlFontSize: +e.target.value })}
                    style={{ ...INPUT_BASE, height: 26 }} />
            </div>
            <div style={ROW}>
                <span style={LABEL}>Connection thickness (px)</span>
                <input type="number" min={1} max={6} value={options.sdlConnectionThickness}
                    onChange={e => onChange({ sdlConnectionThickness: +e.target.value })}
                    style={{ ...INPUT_BASE, height: 26 }} />
            </div>
            <div style={ROW}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#cdd6f4', fontSize: 11, padding: '2px 0' }}>
                    <input type="checkbox" checked={options.snapEnabled}
                        onChange={e => onChange({ snapEnabled: e.target.checked })} style={{ cursor: 'pointer' }} />
                    Snap to grid
                </label>
            </div>
            <div style={ROW}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#cdd6f4', fontSize: 11, padding: '2px 0' }}>
                    <input type="checkbox" checked={options.showMinimap}
                        onChange={e => onChange({ showMinimap: e.target.checked })} style={{ cursor: 'pointer' }} />
                    Show minimap
                </label>
            </div>

            <div style={SEP} />
            <div style={{ color: '#cba6f7', fontWeight: 'bold', marginBottom: 4 }}>Appearance</div>

            <ColorInputRow label="Canvas color"    value={options.sdlCanvasColor}       onChange={v => onChange({ sdlCanvasColor: v })} />
            <ColorInputRow label="Default fill"    value={options.sdlDefaultFillColor}  onChange={v => onChange({ sdlDefaultFillColor: v })} />
            <ColorInputRow label="Default border"  value={options.sdlDefaultBorderColor} onChange={v => onChange({ sdlDefaultBorderColor: v })} />
            <ColorInputRow label="Default text"    value={options.sdlDefaultTextColor}  onChange={v => onChange({ sdlDefaultTextColor: v })} />
            <ColorInputRow label="Connection"      value={options.sdlConnectionColor}   onChange={v => onChange({ sdlConnectionColor: v })} />
            <ColorInputRow label="State"           value={options.sdlStateColor}        onChange={v => onChange({ sdlStateColor: v })} />
            <ColorInputRow label="Input / CS"      value={options.sdlInputColor}        onChange={v => onChange({ sdlInputColor: v })} />
            <ColorInputRow label="Output"          value={options.sdlOutputColor}       onChange={v => onChange({ sdlOutputColor: v })} />
            <ColorInputRow label="Task"            value={options.sdlTaskColor}         onChange={v => onChange({ sdlTaskColor: v })} />
            <ColorInputRow label="Decision"        value={options.sdlDecisionColor}     onChange={v => onChange({ sdlDecisionColor: v })} />
            <ColorInputRow label="Procedure"       value={options.sdlProcedureColor}    onChange={v => onChange({ sdlProcedureColor: v })} />
            <ColorInputRow label="Start / Nextstate" value={options.sdlStartColor}     onChange={v => onChange({ sdlStartColor: v })} />
            <ColorInputRow label="Comment"         value={options.sdlCommentColor}      onChange={v => onChange({ sdlCommentColor: v })} />
            <ColorInputRow label="Text area"       value={options.sdlTextAreaColor}     onChange={v => onChange({ sdlTextAreaColor: v })} />
        </div>
    );
}

// ── Properties panel ─────────────────────────────────────────────────────────

function findSymbol(tree: SdlSymbol[], id: string): SdlSymbol | null {
    for (const s of tree) {
        if (s.id === id) return s;
        const found = findSymbol(s.children, id);
        if (found) return found;
    }
    return null;
}

interface PropsPanelProps { selectedId: string | null; sdl: SdlModel; }

function PropertiesPanel({ selectedId, sdl }: PropsPanelProps): React.ReactElement | null {
    const sym = selectedId ? findSymbol(sdl.tree, selectedId) : null;
    const [editText, setEditText] = useState('');

    useEffect(() => { setEditText(sym?.text ?? ''); }, [sym]);

    if (!sym) return null;

    return (
        <div style={PANEL_STYLE}>
            <div style={{ color: '#cba6f7', fontWeight: 'bold', marginBottom: 8 }}>
                {sym.kind}
            </div>
            <div style={ROW}>
                <label style={LABEL}>Text</label>
                <textarea
                    style={TEXTAREA_STYLE}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    rows={5}
                />
            </div>
            <div style={{ marginTop: 6 }}>
                <button
                    style={{ background: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 11 }}
                    onClick={() => post({ type: 'sdlTextEdited', id: sym.id, text: editText } satisfies SdlWebviewMessage)}
                >Apply</button>
            </div>
            {sym.cif && (
                <>
                    <div style={SEP} />
                    <span style={{ color: '#6c7086', fontSize: 10 }}>
                        ({sym.cif.x}, {sym.cif.y}) · {sym.cif.w}×{sym.cif.h}
                    </span>
                </>
            )}
        </div>
    );
}

// ── Inner editor (has access to useReactFlow) ─────────────────────────────────

interface SdlEditorProps {
    sdl: SdlModel;
    options: EditorOptions;
    onOptionsChange: (patch: Partial<EditorOptions>) => void;
}

function SdlEditor({ sdl, options, onOptionsChange }: SdlEditorProps): React.ReactElement {
    const { fitView } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<SdlNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    const [locked, setLocked]           = useState(false);
    const [showOptions, setShowOptions]  = useState(false);
    const [selectedId, setSelectedId]   = useState<string | null>(null);
    const [levelPath, setLevelPath]      = useState<SdlSymbol[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

    // Current level's flat symbol list and parent kind
    const currentSymbols = levelPath.length === 0
        ? sdl.tree
        : levelPath[levelPath.length - 1].children;
    const parentKind: SdlSymbolKind | null = levelPath.length === 0
        ? null
        : levelPath[levelPath.length - 1].kind;

    // Rebuild graph whenever level or options change
    useEffect(() => {
        const graph = buildSdlGraph(currentSymbols, parentKind, options);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setTimeout(() => fitView({ padding: 0.1 }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sdl, levelPath, options, setNodes, setEdges, fitView]);

    const handleNodesChange = useCallback(
        (changes: NodeChange[]) => { if (!locked) onNodesChange(changes); },
        [locked, onNodesChange],
    );

    const handleNodeDragStop: NodeDragHandler = useCallback((_event, node) => {
        post({
            type: 'sdlSymbolMoved',
            id: node.id,
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
            w: Math.round(node.width ?? 150),
            h: Math.round(node.height ?? 60),
        } satisfies SdlWebviewMessage);
    }, []);

    const handleNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
        if (!node.data.hasChildren) return;
        const sym = findSymbol(sdl.tree, node.id);
        if (sym) {
            setLevelPath(prev => [...prev, sym]);
            setSelectedId(null);
        }
    }, [sdl]);

    const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
        setSelectedId(node.id);
    }, []);

    const navigateTo = useCallback((index: number) => {
        if (index < 0) {
            setLevelPath([]);
        } else {
            setLevelPath(prev => prev.slice(0, index + 1));
        }
        setSelectedId(null);
    }, []);

    const handleExport = useCallback(() => {
        post({ type: 'requestExport' } satisfies SdlWebviewMessage);
    }, []);

    const handlePaneClick = useCallback(() => {
        setSelectedId(null);
    }, []);

    const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const items: ContextMenuItem[] = [];
        if (levelPath.length > 0) {
            items.push({ label: 'Go Up', onClick: () => navigateTo(levelPath.length - 2) });
        }
        items.push(
            { label: 'Fit View', onClick: () => fitView({ padding: 0.1 }) },
            { label: 'Export as Image', onClick: handleExport },
            { label: showOptions ? 'Hide Options' : 'Options', onClick: () => setShowOptions(v => !v) },
        );
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    }, [levelPath, navigateTo, fitView, handleExport, showOptions]);

    const handleNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
        e.preventDefault();
        const sym = findSymbol(sdl.tree, node.id);
        const items: ContextMenuItem[] = [
            {
                label: 'Open Properties',
                onClick: () => { setSelectedId(node.id); setShowOptions(false); },
            },
        ];
        if (sym && sym.children.length > 0) {
            items.push({
                label: 'Navigate Into',
                onClick: () => {
                    setLevelPath(prev => [...prev, sym]);
                    setSelectedId(null);
                },
            });
        }
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    }, [sdl]);

    const breadcrumbHeight = levelPath.length > 0 ? 28 : 0;
    const rightPanelWidth = showOptions || selectedId ? 300 : 0;

    return (
        <div style={{ position: 'absolute', inset: 0, background: options.sdlCanvasColor }}>
            <SdlBreadcrumb levelPath={levelPath} onNavigateTo={navigateTo} />

            {/* Canvas area — inset from palette (left 44px) and breadcrumb (top) */}
            <div style={{
                position: 'absolute',
                left: 44,
                top: breadcrumbHeight,
                right: rightPanelWidth,
                bottom: 0,
            }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeDragStop={handleNodeDragStop}
                    onNodeClick={handleNodeClick}
                    onNodeDoubleClick={handleNodeDoubleClick}
                    onPaneClick={handlePaneClick}
                    onPaneContextMenu={handlePaneContextMenu}
                    onNodeContextMenu={handleNodeContextMenu}
                    nodeTypes={NODE_TYPES}
                    nodesDraggable={!locked}
                    nodesConnectable={false}
                    elementsSelectable={!locked}
                    snapToGrid={options.snapEnabled}
                    snapGrid={[options.snapGridSize, options.snapGridSize]}
                    style={{ background: options.sdlCanvasColor }}
                    minZoom={0.05}
                    maxZoom={4}
                    fitView
                >
                    {options.showMinimap && (
                        <MiniMap pannable zoomable position="top-right" style={{ background: '#181825' }} />
                    )}
                </ReactFlow>
            </div>

            {/* Left palette — must be inside ReactFlowProvider to use useReactFlow */}
            <SdlPalette
                locked={locked}
                showOptions={showOptions}
                onToggleLock={() => setLocked(l => !l)}
                onToggleOptions={() => { setShowOptions(v => !v); if (!showOptions) setSelectedId(null); }}
                onExport={handleExport}
            />

            {/* Right panel */}
            {showOptions
                ? <SdlOptionsPanel options={options} onChange={onOptionsChange} onClose={() => setShowOptions(false)} />
                : selectedId
                    ? <PropertiesPanel selectedId={selectedId} sdl={sdl} />
                    : null
            }
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenu.items}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}

// ── Root SdlApp ───────────────────────────────────────────────────────────────

export default function SdlApp(): React.ReactElement {
    const [sdl, setSdl]         = useState<SdlModel | null>(null);
    const [options, setOptions] = useState<EditorOptions>(DEFAULT_OPTIONS);

    const handleOptionsChange = useCallback((patch: Partial<EditorOptions>) => {
        setOptions(prev => {
            const updated = { ...prev, ...patch };
            post({ type: 'updateOptions', options: updated } satisfies SdlWebviewMessage);
            return updated;
        });
    }, []);

    useEffect(() => {
        const handler = (event: MessageEvent): void => {
            const msg = event.data as SdlExtensionMessage;
            switch (msg.type) {
                case 'loadSdl':
                    setSdl(msg.data.sdl);
                    break;
                case 'options':
                    setOptions(msg.options);
                    break;
                case 'requestExport':
                    // Extension is requesting an image export — not yet implemented for SDL.
                    // Silently ignore to avoid re-posting and creating an infinite loop.
                    break;
            }
        };
        window.addEventListener('message', handler);
        post({ type: 'ready' } satisfies SdlWebviewMessage);
        return () => window.removeEventListener('message', handler);
    }, []);

    if (!sdl) {
        return (
            <div style={{ color: '#cdd6f4', fontFamily: 'monospace', padding: 20 }}>
                Loading SDL diagram…
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <ReactFlowProvider>
                <SdlEditor sdl={sdl} options={options} onOptionsChange={handleOptionsChange} />
            </ReactFlowProvider>
        </div>
    );
}
