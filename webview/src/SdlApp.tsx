import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Background,
    Controls,
    Edge,
    MiniMap,
    Node,
    NodeChange,
    NodeDragHandler,
    NodeProps,
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
    SdlSymbolKind,
    SdlWebviewMessage,
} from '../../src/model/types';
import { post } from './vscodeApi';
import { buildSdlGraph, SDL_SYMBOL_NODE, SdlNodeData, sdlFillColor } from './sdlTransform';

// ── Style constants ─────────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 300,
    background: '#181825', borderLeft: '1px solid #313244', padding: 10,
    overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, zIndex: 15,
};
const SECTION: React.CSSProperties = { color: '#cba6f7', fontWeight: 'bold', marginBottom: 8 };
const ROW: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 };
const LABEL: React.CSSProperties = { color: '#a6adc8', fontSize: 11 };
const TEXTAREA: React.CSSProperties = {
    background: '#1e1e2e', color: '#cdd6f4', border: '1px solid #45475a',
    borderRadius: 4, padding: '4px 6px', fontSize: 11, fontFamily: 'monospace',
    width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 60,
};
const BTN: React.CSSProperties = {
    background: '#313244', color: '#cdd6f4', border: '1px solid #45475a',
    borderRadius: 4, padding: '5px 8px', cursor: 'pointer', fontSize: 11,
};
const BTN_PRIMARY: React.CSSProperties = { ...BTN, background: '#89b4fa', color: '#1e1e2e', borderColor: '#89b4fa' };
const SEP: React.CSSProperties = { borderTop: '1px solid #313244', margin: '10px 0' };

// ── SDL symbol SVG shapes ───────────────────────────────────────────────────

interface ShapeProps { w: number; h: number; fill: string; stroke: string; strokeWidth: number; }

function PillShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const rx = Math.min(h / 2, w / 2);
    return <rect x={strokeWidth / 2} y={strokeWidth / 2} width={w - strokeWidth} height={h - strokeWidth} rx={rx} ry={rx} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function RectShape({ w, h, fill, stroke, strokeWidth }: ShapeProps): React.ReactElement {
    const pad = strokeWidth / 2;
    return <rect x={pad} y={pad} width={w - strokeWidth} height={h - strokeWidth} rx={4} ry={4} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
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
        case 'return':       return <PillShape {...props} />;
        case 'state':        return <RectShape {...props} />;
        case 'stateAggregation': return <DoubleRectShape {...props} />;
        case 'input':
        case 'continuousSignal':
        case 'output':       return <StepCutRectShape {...props} />;
        case 'task':         return <RectShape {...props} />;
        case 'decision':
        case 'alternative':  return <DiamondShape {...props} />;
        case 'answer':       return <RectShape {...props} />;
        case 'procedure':
        case 'procedureCall': return <DoubleRectShape {...props} />;
        case 'join':         return <CircleShape {...props} />;
        case 'label':        return <CircleShape {...props} />;
        case 'connect':      return <DoubleCircleShape {...props} />;
        case 'comment':      return <DogEarShape {...props} />;
        case 'textArea':     return <DashedRectShape {...props} />;
        default:             return <RectShape {...props} />;
    }
}

// ── Custom SDL node ─────────────────────────────────────────────────────────

function SdlSymbolNode({ id, data, width, height, selected }: NodeProps<Node<SdlNodeData>>): React.ReactElement {
    const { kind, text, options } = data;
    const w = width ?? 150;
    const h = height ?? 60;
    const fill   = sdlFillColor(kind, options);
    const stroke = selected ? '#cba6f7' : options.sdlDefaultBorderColor;
    const sw     = selected ? 2 : options.sdlConnectionThickness;
    const fontSize = options.sdlFontSize;
    const textColor = options.sdlDefaultTextColor;

    // Truncate text for display
    const displayText = text.length > 80 ? text.slice(0, 77) + '...' : text;

    return (
        <div style={{ width: w, height: h, position: 'relative' }}>
            <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
                {renderShape(kind, w, h, fill, stroke, sw)}
                <foreignObject x={sw + 2} y={sw + 2} width={w - sw * 2 - 4} height={h - sw * 2 - 4}>
                    <div
                        style={{
                            width: '100%', height: '100%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            overflow: 'hidden', color: textColor,
                            fontSize, fontFamily: 'monospace',
                            padding: '2px 4px', boxSizing: 'border-box',
                            wordBreak: 'break-all', textAlign: 'center',
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {displayText}
                    </div>
                </foreignObject>
            </svg>
        </div>
    );
}

const NODE_TYPES = { [SDL_SYMBOL_NODE]: SdlSymbolNode };

// ── Main SDL App ────────────────────────────────────────────────────────────

function SdlCanvas({
    sdl,
    options,
    locked,
}: {
    sdl: SdlModel;
    options: EditorOptions;
    locked: boolean;
}): React.ReactElement {
    const { fitView } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<SdlNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    useEffect(() => {
        const graph = buildSdlGraph(sdl, options);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setTimeout(() => fitView({ padding: 0.1 }), 50);
    }, [sdl, options, setNodes, setEdges, fitView]);

    const handleNodesChange = useCallback(
        (changes: NodeChange[]) => {
            if (!locked) onNodesChange(changes);
        },
        [locked, onNodesChange],
    );

    const handleNodeDragStop: NodeDragHandler = useCallback(
        (_event, node) => {
            post({
                type: 'sdlSymbolMoved',
                id: node.id,
                x: Math.round(node.position.x),
                y: Math.round(node.position.y),
                w: Math.round(node.width ?? 150),
                h: Math.round(node.height ?? 60),
            } satisfies SdlWebviewMessage);
        },
        [],
    );

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
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
            <Background />
            <Controls />
            {options.showMinimap && <MiniMap />}
        </ReactFlow>
    );
}

// ── Properties panel ────────────────────────────────────────────────────────

interface PropsPanelProps {
    selectedId: string | null;
    sdl: SdlModel;
}

function findSymbolInTree(tree: import('../../src/model/types').SdlSymbol[], id: string): import('../../src/model/types').SdlSymbol | null {
    for (const s of tree) {
        if (s.id === id) return s;
        const found = findSymbolInTree(s.children, id);
        if (found) return found;
    }
    return null;
}

function PropertiesPanel({ selectedId, sdl }: PropsPanelProps): React.ReactElement | null {
    const sym = selectedId ? findSymbolInTree(sdl.tree, selectedId) : null;
    const [editText, setEditText] = useState('');

    useEffect(() => {
        setEditText(sym?.text ?? '');
    }, [sym]);

    if (!sym) return null;

    const handleSave = (): void => {
        post({ type: 'sdlTextEdited', id: sym.id, text: editText } satisfies SdlWebviewMessage);
    };

    return (
        <div style={PANEL}>
            <div style={SECTION}>Symbol: {sym.kind}</div>
            <div style={SEP} />
            <div style={ROW}>
                <label style={LABEL}>Text</label>
                <textarea
                    style={TEXTAREA}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    rows={5}
                />
            </div>
            <div style={ROW}>
                <button style={BTN_PRIMARY} onClick={handleSave}>Apply</button>
            </div>
            {sym.cif && (
                <>
                    <div style={SEP} />
                    <div style={LABEL}>Position: ({sym.cif.x}, {sym.cif.y}) &nbsp; Size: {sym.cif.w}×{sym.cif.h}</div>
                </>
            )}
        </div>
    );
}

// ── Options panel ───────────────────────────────────────────────────────────

interface OptionsPanelProps {
    options: EditorOptions;
    onClose: () => void;
}

function OptionsPanel({ options, onClose }: OptionsPanelProps): React.ReactElement {
    const [local, setLocal] = useState<EditorOptions>(options);

    const patch = (k: keyof EditorOptions, v: unknown): void =>
        setLocal(prev => ({ ...prev, [k]: v }));

    const handleSave = (): void => {
        post({ type: 'updateOptions', options: local } satisfies SdlWebviewMessage);
        onClose();
    };

    const colorRow = (label: string, key: keyof EditorOptions): React.ReactElement => (
        <div style={ROW} key={key}>
            <label style={LABEL}>{label}</label>
            <input
                type="color"
                value={local[key] as string}
                onChange={e => patch(key, e.target.value)}
                style={{ width: 40, height: 24, border: 'none', background: 'none', cursor: 'pointer' }}
            />
        </div>
    );

    return (
        <div style={{ ...PANEL, width: 340 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={SECTION}>SDL Options</span>
                <button style={BTN} onClick={onClose}>✕</button>
            </div>
            <div style={ROW}>
                <label style={LABEL}>Font size (px)</label>
                <input
                    type="number"
                    min={8} max={24}
                    value={local.sdlFontSize}
                    onChange={e => patch('sdlFontSize', +e.target.value)}
                    style={{ ...TEXTAREA, height: 26, resize: 'none', minHeight: 0 }}
                />
            </div>
            <div style={ROW}>
                <label style={LABEL}>Connection thickness (px)</label>
                <input
                    type="number"
                    min={1} max={6}
                    value={local.sdlConnectionThickness}
                    onChange={e => patch('sdlConnectionThickness', +e.target.value)}
                    style={{ ...TEXTAREA, height: 26, resize: 'none', minHeight: 0 }}
                />
            </div>
            <div style={ROW}>
                <label style={LABEL}>
                    <input
                        type="checkbox"
                        checked={local.snapEnabled}
                        onChange={e => patch('snapEnabled', e.target.checked)}
                    />
                    &nbsp;Snap to grid
                </label>
            </div>
            <div style={ROW}>
                <label style={LABEL}>
                    <input
                        type="checkbox"
                        checked={local.showMinimap}
                        onChange={e => patch('showMinimap', e.target.checked)}
                    />
                    &nbsp;Show minimap
                </label>
            </div>
            <div style={SEP} />
            <div style={SECTION}>Appearance</div>
            {colorRow('Canvas color', 'sdlCanvasColor')}
            {colorRow('Default fill', 'sdlDefaultFillColor')}
            {colorRow('Default border', 'sdlDefaultBorderColor')}
            {colorRow('Default text', 'sdlDefaultTextColor')}
            {colorRow('Connection', 'sdlConnectionColor')}
            {colorRow('State', 'sdlStateColor')}
            {colorRow('Input', 'sdlInputColor')}
            {colorRow('Output', 'sdlOutputColor')}
            {colorRow('Task', 'sdlTaskColor')}
            {colorRow('Decision', 'sdlDecisionColor')}
            {colorRow('Procedure', 'sdlProcedureColor')}
            {colorRow('Start / Nextstate', 'sdlStartColor')}
            {colorRow('Comment', 'sdlCommentColor')}
            {colorRow('Text area', 'sdlTextAreaColor')}
            <div style={SEP} />
            <button style={BTN_PRIMARY} onClick={handleSave}>Save options</button>
        </div>
    );
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

interface ToolbarProps {
    locked: boolean;
    onToggleLock: () => void;
    onOptions: () => void;
    onExport: () => void;
}

function Toolbar({ locked, onToggleLock, onOptions, onExport }: ToolbarProps): React.ReactElement {
    const btnStyle: React.CSSProperties = {
        background: '#313244', color: '#cdd6f4', border: '1px solid #45475a',
        borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
    };
    return (
        <div style={{
            position: 'absolute', top: 8, left: 8, zIndex: 20,
            display: 'flex', gap: 6,
        }}>
            <button style={btnStyle} title="Toggle lock" onClick={onToggleLock}>
                {locked ? '🔒' : '🔓'}
            </button>
            <button style={btnStyle} title="Options" onClick={onOptions}>⚙</button>
            <button style={btnStyle} title="Export image" onClick={onExport}>⬇</button>
        </div>
    );
}

// ── Root SdlApp ─────────────────────────────────────────────────────────────

export default function SdlApp(): React.ReactElement {
    const [sdl, setSdl]         = useState<SdlModel | null>(null);
    const [options, setOptions] = useState<EditorOptions>(DEFAULT_OPTIONS);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [locked, setLocked]   = useState(false);
    const [showOptions, setShowOptions] = useState(false);

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
                    post({ type: 'requestExport' } satisfies SdlWebviewMessage);
                    break;
            }
        };
        window.addEventListener('message', handler);
        post({ type: 'ready' } satisfies SdlWebviewMessage);
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleExport = useCallback((): void => {
        post({ type: 'requestExport' } satisfies SdlWebviewMessage);
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
                <SdlCanvas sdl={sdl} options={options} locked={locked} />
            </ReactFlowProvider>

            <Toolbar
                locked={locked}
                onToggleLock={() => setLocked(l => !l)}
                onOptions={() => setShowOptions(v => !v)}
                onExport={handleExport}
            />

            {showOptions
                ? <OptionsPanel options={options} onClose={() => setShowOptions(false)} />
                : <PropertiesPanel selectedId={selectedId} sdl={sdl} />
            }
        </div>
    );
}
