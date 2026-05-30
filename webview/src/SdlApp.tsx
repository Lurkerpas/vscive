import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Edge,
    Handle,
    MiniMap,
    Node,
    NodeChange,
    NodeDragHandler,
    OnNodesDelete,
    NodeMouseHandler,
    NodeResizer,
    OnNodesChange,
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
    SdlInsertKind,
    SdlModel,
    SdlSymbol,
    SdlSymbolKind,
    SdlWebviewMessage,
} from '../../src/model/types';
import {
    SDL_CANVAS_INSERT_TYPES,
    SDL_FOLLOW_INSERT_TYPES_BY_SYMBOL,
    SDL_INSERT_LABELS,
} from '../../src/model/sdlInsertRules';
import { post } from './vscodeApi';
import { buildSdlGraph, SDL_SYMBOL_NODE, SdlNodeData, sdlFillColor } from './sdlTransform';
import { ContextMenu, ContextMenuItem } from './components/ContextMenu';
import { SdlEdge } from './components/SdlEdge';
import { formatSdlDisplayText, shouldLeftAlignSdlText } from './sdlTextLayout';
import { inputShapePoints, outputShapePoints, returnCrossLines } from './sdlShapeGeometry';
import { renderSdlDiagramImage } from './sdlExportImage';

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

function InputShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const points = inputShapePoints(w, h, strokeWidth);
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function OutputShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const points = outputShapePoints(w, h, strokeWidth);
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

function ReturnShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const lines = returnCrossLines(w, h, strokeWidth);
    return (
        <g>
            <CircleShape w={w} h={h} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
            {lines.map((line, index) => (
                <line
                    key={index}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                />
            ))}
        </g>
    );
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
        case 'nextstate':      return <PillShape {...props} />;
        case 'return':         return <ReturnShape {...props} />;
        case 'state':          return <RoundedRectShape {...props} />;
        case 'stateAggregation': return <DoubleRectShape {...props} />;
        case 'input':
        case 'continuousSignal': return <InputShape {...props} />;
        case 'output':         return <OutputShape {...props} />;
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
    const { kind, text, options, hasChildren, locked } = data;
    const w = width ?? 150;
    const h = height ?? 60;
    const fill   = sdlFillColor(kind, options);
    const stroke = selected ? '#cba6f7' : options.sdlDefaultBorderColor;
    const sw     = selected ? 2 : options.sdlConnectionThickness;
    const leftAlignedText = shouldLeftAlignSdlText(kind);
    const displayText = formatSdlDisplayText(kind, text);
    const allowTextOverflow = kind === 'return' || kind === 'join';
    const textInset = sw + 2;
    const textBoxWidth = Math.max(0, w - sw * 2 - 4);
    const textBoxHeight = Math.max(0, h - sw * 2 - 4);

    return (
        <div style={{ width: w, height: h, position: 'relative', background: 'transparent', overflow: 'visible' }}>
            <NodeResizer
                isVisible={selected && !locked}
                minWidth={35}
                minHeight={35}
                lineStyle={{ borderColor: '#89b4fa', borderWidth: 1 }}
                handleStyle={{ width: 10, height: 10, background: '#89b4fa', borderRadius: 2 }}
            />
            {/* Invisible handles so ReactFlow can draw edges */}
            <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
            <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
                {renderShape(kind, w, h, fill, stroke, sw)}
            </svg>
            {allowTextOverflow ? (
                <div
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: options.sdlDefaultTextColor,
                        fontSize: options.sdlFontSize,
                        fontFamily: 'monospace',
                        padding: '2px 4px',
                        boxSizing: 'border-box',
                        textAlign: 'center',
                        whiteSpace: 'pre',
                        overflow: 'visible',
                        pointerEvents: 'none',
                    }}
                >
                    {displayText}
                </div>
            ) : (
                <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
                    <foreignObject x={textInset} y={textInset} width={textBoxWidth} height={textBoxHeight}>
                        <div
                            style={{
                                width: '100%', height: '100%',
                                display: 'flex',
                                alignItems: leftAlignedText ? 'flex-start' : 'center',
                                justifyContent: leftAlignedText ? 'flex-start' : 'center',
                                overflow: 'hidden', color: options.sdlDefaultTextColor,
                                fontSize: options.sdlFontSize, fontFamily: 'monospace',
                                padding: '2px 4px', boxSizing: 'border-box',
                                wordBreak: leftAlignedText ? 'normal' : 'break-all',
                                overflowWrap: 'anywhere',
                                textAlign: leftAlignedText ? 'left' : 'center',
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
            )}
            <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
        </div>
    );
}

const NODE_TYPES = { [SDL_SYMBOL_NODE]: SdlSymbolNode };
const EDGE_TYPES = { sdlEdge: SdlEdge };

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
        const nestedFound = findSymbol(s.nestedChildren, id);
        if (nestedFound) return nestedFound;
    }
    return null;
}

function getNavigableChildren(sym: SdlSymbol): SdlSymbol[] {
    return sym.nestedChildren.length > 0 ? sym.nestedChildren : sym.children;
}

function hasNavigableChildren(sym: SdlSymbol): boolean {
    if (sym.nestedChildren.length > 0) return true;
    if (sym.kind === 'state') return false;
    return sym.children.length > 0;
}

function navigationParentKind(sym: SdlSymbol): SdlSymbolKind | null {
    return sym.nestedChildren.length > 0 ? null : sym.kind;
}

function updateSymbolText(tree: SdlSymbol[], id: string, text: string): SdlSymbol[] {
    return tree.map(symbol => {
        const children = updateSymbolText(symbol.children, id, text);
        const nestedChildren = updateSymbolText(symbol.nestedChildren, id, text);
        if (symbol.id !== id && children === symbol.children && nestedChildren === symbol.nestedChildren) {
            return symbol;
        }
        return {
            ...symbol,
            text: symbol.id === id ? text : symbol.text,
            children,
            nestedChildren,
        };
    });
}

function updateSymbolGeometry(tree: SdlSymbol[], id: string, x: number, y: number, w: number, h: number): SdlSymbol[] {
    return tree.map(symbol => {
        const children = updateSymbolGeometry(symbol.children, id, x, y, w, h);
        const nestedChildren = updateSymbolGeometry(symbol.nestedChildren, id, x, y, w, h);
        if (symbol.id !== id && children === symbol.children && nestedChildren === symbol.nestedChildren) {
            return symbol;
        }
        return {
            ...symbol,
            cif: symbol.id === id && symbol.cif
                ? { x, y, w, h }
                : symbol.cif,
            children,
            nestedChildren,
        };
    });
}

function deleteSymbolsFromTree(tree: SdlSymbol[], idsToDelete: Set<string>): SdlSymbol[] {
    return tree
        .filter(symbol => !idsToDelete.has(symbol.id))
        .map(symbol => ({
            ...symbol,
            children: deleteSymbolsFromTree(symbol.children, idsToDelete),
            nestedChildren: deleteSymbolsFromTree(symbol.nestedChildren, idsToDelete),
        }));
}

interface PropsPanelProps {
    selectedId: string | null;
    sdl: SdlModel;
    onTextChange: (id: string, text: string) => void;
}

function PropertiesPanel({ selectedId, sdl, onTextChange }: PropsPanelProps): React.ReactElement | null {
    const sym = selectedId ? findSymbol(sdl.tree, selectedId) : null;

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
                    value={sym.text}
                    onChange={e => onTextChange(sym.id, e.target.value)}
                    rows={5}
                />
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
    onSymbolGeometryChange: (id: string, x: number, y: number, w: number, h: number) => void;
    onSymbolTextChange: (id: string, text: string) => void;
    onSymbolsDelete: (ids: string[]) => void;
    pendingExportFormat: 'png' | 'svg' | null;
    onExportHandled: () => void;
}

function SdlEditor({ sdl, options, onOptionsChange, onSymbolGeometryChange, onSymbolTextChange, onSymbolsDelete, pendingExportFormat, onExportHandled }: SdlEditorProps): React.ReactElement {
    const { fitView, screenToFlowPosition } = useReactFlow();
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
        : getNavigableChildren(levelPath[levelPath.length - 1]);
    const parentKind: SdlSymbolKind | null = levelPath.length === 0
        ? null
        : navigationParentKind(levelPath[levelPath.length - 1]);

    useEffect(() => {
        setLevelPath(prev => {
            if (prev.length === 0) {
                return prev;
            }

            const nextPath = prev
                .map(symbol => findSymbol(sdl.tree, symbol.id))
                .filter((symbol): symbol is SdlSymbol => symbol !== null);

            if (nextPath.length === prev.length && nextPath.every((symbol, index) => symbol === prev[index])) {
                return prev;
            }

            return nextPath;
        });
    }, [sdl]);

    // Rebuild graph whenever level or options change
    useEffect(() => {
        const graph = buildSdlGraph(currentSymbols, parentKind, options);
        setNodes(
            graph.nodes
                .map(node => ({
                    ...node,
                    data: { ...node.data, locked },
                }))
                .sort((left, right) => {
                    const leftTextArea = left.data.kind === 'textArea' ? -1 : 0;
                    const rightTextArea = right.data.kind === 'textArea' ? -1 : 0;
                    return leftTextArea - rightTextArea;
                }),
        );
        setEdges(graph.edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sdl, levelPath, options, locked, setNodes, setEdges]);

    useEffect(() => {
        setTimeout(() => fitView({ padding: 0.1 }), 50);
    }, [fitView, levelPath]);

    useEffect(() => {
        if (!pendingExportFormat) return;
        let cancelled = false;

        void (async () => {
            const rendered = await renderSdlDiagramImage({
                nodes,
                edges,
                options,
                format: pendingExportFormat,
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

            if (!cancelled && rendered) {
                post({ type: 'exportImage', format: pendingExportFormat, dataUrl: rendered.dataUrl } satisfies SdlWebviewMessage);
            }
            if (!cancelled) {
                onExportHandled();
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [pendingExportFormat, nodes, edges, options, onExportHandled]);

    const handleNodesChange: OnNodesChange<Node<SdlNodeData>> = useCallback((changes: NodeChange[]) => {
        if (locked) {
            return;
        }

        onNodesChange(changes);

        for (const change of changes) {
            if (change.type !== 'dimensions' || change.resizing !== false) {
                continue;
            }

            const dimensions = (change as { dimensions?: { width: number; height: number } }).dimensions;
            if (!dimensions) {
                continue;
            }

            setNodes(existingNodes => existingNodes.map(node => {
                if (node.id !== change.id) {
                    return node;
                }

                const width = Math.max(35, Math.round(dimensions.width));
                const height = Math.max(35, Math.round(dimensions.height));
                const x = Math.round(node.position.x);
                const y = Math.round(node.position.y);
                onSymbolGeometryChange(node.id, x, y, width, height);
                post({
                    type: 'sdlSymbolMoved',
                    id: node.id,
                    x,
                    y,
                    w: width,
                    h: height,
                } satisfies SdlWebviewMessage);

                return {
                    ...node,
                    width,
                    height,
                    measured: { width, height },
                    style: { ...node.style, width, height },
                };
            }));
        }
    }, [locked, onNodesChange, onSymbolGeometryChange, setNodes]);

    const handleNodeDragStop: NodeDragHandler = useCallback((_event, node) => {
        const x = Math.round(node.position.x);
        const y = Math.round(node.position.y);
        const w = Math.round(node.width ?? 150);
        const h = Math.round(node.height ?? 60);
        onSymbolGeometryChange(node.id, x, y, w, h);
        post({
            type: 'sdlSymbolMoved',
            id: node.id,
            x,
            y,
            w,
            h,
        } satisfies SdlWebviewMessage);
    }, [onSymbolGeometryChange]);

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
        setContextMenu(null);
    }, []);

    const deleteSymbols = useCallback((ids: string[]) => {
        if (ids.length === 0) {
            return;
        }
        onSymbolsDelete([...new Set(ids)]);
        setSelectedId(null);
        setContextMenu(null);
    }, [onSymbolsDelete]);

    const handleNodesDelete: OnNodesDelete<Node<SdlNodeData>> = useCallback((deletedNodes) => {
        if (locked) {
            return;
        }
        deleteSymbols(deletedNodes.map(node => node.id));
    }, [deleteSymbols, locked]);

    const createSymbolOnCanvas = useCallback((kind: SdlInsertKind, clientX: number, clientY: number) => {
        const flowPoint = screenToFlowPosition({ x: clientX, y: clientY });
        const containerSymbol = levelPath.length > 0 ? levelPath[levelPath.length - 1] : undefined;
        const containerKind = containerSymbol
            ? (parentKind === null ? 'nestedChildren' : 'children')
            : 'tree';

        post({
            type: 'sdlSymbolCreate',
            kind,
            mode: 'canvas',
            x: Math.round(flowPoint.x),
            y: Math.round(flowPoint.y),
            containerId: containerSymbol?.id,
            containerKind,
        } satisfies SdlWebviewMessage);
        setContextMenu(null);
    }, [levelPath, parentKind, screenToFlowPosition]);

    const createSymbolFollowing = useCallback((anchorId: string, kind: SdlInsertKind, x: number, y: number) => {
        post({
            type: 'sdlSymbolCreate',
            kind,
            mode: 'following',
            anchorId,
            x: Math.round(x),
            y: Math.round(y),
        } satisfies SdlWebviewMessage);
        setContextMenu(null);
    }, []);

    const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const items: ContextMenuItem[] = [];
        if (!locked) {
            const canCreateProcedure = levelPath.length === 0;
            const canvasInsertKinds = SDL_CANVAS_INSERT_TYPES.filter(kind => kind !== 'procedure' || canCreateProcedure);
            if (canvasInsertKinds.length > 0) {
                items.push({
                    label: '+ Add Symbol',
                    children: canvasInsertKinds.map(kind => ({
                        label: SDL_INSERT_LABELS[kind],
                        onClick: () => createSymbolOnCanvas(kind, e.clientX, e.clientY),
                    })),
                });
            }
        }
        if (levelPath.length > 0) {
            items.push({ label: 'Go Up', onClick: () => navigateTo(levelPath.length - 2) });
        }
        items.push(
            { label: 'Fit View', onClick: () => fitView({ padding: 0.1 }) },
            { label: 'Export as Image', onClick: handleExport },
            { label: showOptions ? 'Hide Options' : 'Options', onClick: () => setShowOptions(v => !v) },
        );
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    }, [createSymbolOnCanvas, fitView, handleExport, levelPath, locked, navigateTo, showOptions]);

    const handleNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
        e.preventDefault();
        const sym = findSymbol(sdl.tree, node.id);
        const items: ContextMenuItem[] = [
            {
                label: 'Open Properties',
                onClick: () => { setSelectedId(node.id); setShowOptions(false); },
            },
        ];
        if (!locked) {
            const followKinds = (SDL_FOLLOW_INSERT_TYPES_BY_SYMBOL[node.data.kind] ?? [])
                .filter(kind => kind !== 'state' || parentKind === null)
                .filter(kind => kind !== 'decisionAlternative' || node.data.kind === 'decision');
            if (followKinds.length > 0) {
                items.push({
                    label: '+ Add Following',
                    children: followKinds.map(kind => ({
                        label: SDL_INSERT_LABELS[kind],
                        onClick: () => createSymbolFollowing(node.id, kind, node.position.x, node.position.y),
                    })),
                });
            }
        }
        if (sym && hasNavigableChildren(sym)) {
            items.push({
                label: 'Navigate Into',
                onClick: () => {
                    setLevelPath(prev => [...prev, sym]);
                    setSelectedId(null);
                },
            });
        }
        if (!locked) {
            items.push({
                label: 'Delete',
                danger: true,
                onClick: () => deleteSymbols([node.id]),
            });
        }
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    }, [createSymbolFollowing, deleteSymbols, locked, parentKind, sdl]);

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
                    onNodesDelete={locked ? undefined : handleNodesDelete}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    nodesDraggable={!locked}
                    nodesConnectable={false}
                    elementsSelectable={!locked}
                    deleteKeyCode={locked ? null : ['Delete']}
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
                    ? <PropertiesPanel selectedId={selectedId} sdl={sdl} onTextChange={onSymbolTextChange} />
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
    const [pendingExportFormat, setPendingExportFormat] = useState<'png' | 'svg' | null>(null);

    const handleOptionsChange = useCallback((patch: Partial<EditorOptions>) => {
        setOptions(prev => {
            const updated = { ...prev, ...patch };
            post({ type: 'updateOptions', options: updated } satisfies SdlWebviewMessage);
            return updated;
        });
    }, []);

    const handleSymbolGeometryChange = useCallback((id: string, x: number, y: number, w: number, h: number) => {
        setSdl(prev => prev ? { ...prev, tree: updateSymbolGeometry(prev.tree, id, x, y, w, h) } : prev);
    }, []);

    const handleSymbolTextChange = useCallback((id: string, text: string) => {
        setSdl(prev => prev ? { ...prev, tree: updateSymbolText(prev.tree, id, text) } : prev);
        post({ type: 'sdlTextEdited', id, text } satisfies SdlWebviewMessage);
    }, []);

    const handleSymbolsDelete = useCallback((ids: string[]) => {
        const idsToDelete = new Set(ids);
        setSdl(prev => prev ? { ...prev, tree: deleteSymbolsFromTree(prev.tree, idsToDelete) } : prev);
        post({ type: 'sdlSymbolsDeleted', ids } satisfies SdlWebviewMessage);
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
                    setPendingExportFormat(msg.format);
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
                <SdlEditor
                    sdl={sdl}
                    options={options}
                    onOptionsChange={handleOptionsChange}
                    onSymbolGeometryChange={handleSymbolGeometryChange}
                    onSymbolTextChange={handleSymbolTextChange}
                    onSymbolsDelete={handleSymbolsDelete}
                    pendingExportFormat={pendingExportFormat}
                    onExportHandled={() => setPendingExportFormat(null)}
                />
            </ReactFlowProvider>
        </div>
    );
}
