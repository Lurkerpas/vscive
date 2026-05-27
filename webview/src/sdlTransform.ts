/**
 * Converts an SdlModel into ReactFlow nodes and edges.
 */

import { Edge, MarkerType, Node } from '@xyflow/react';
import { EditorOptions, SdlModel, SdlSymbol, SdlSymbolKind } from '../../src/model/types';

// ── Node / edge type names ──────────────────────────────────────────────────

export const SDL_SYMBOL_NODE = 'sdlSymbol';

// ── Auto-layout constants ───────────────────────────────────────────────────

const DEFAULT_WIDTH  = 150;
const DEFAULT_HEIGHT = 60;
const AUTO_GAP       = 20;

// ── Node data ───────────────────────────────────────────────────────────────

export interface SdlNodeData extends Record<string, unknown> {
    kind: SdlSymbolKind;
    text: string;
    options: EditorOptions;
}

// ── Build graph ─────────────────────────────────────────────────────────────

export function buildSdlGraph(
    sdl: SdlModel,
    options: EditorOptions,
): { nodes: Node<SdlNodeData>[]; edges: Edge[] } {
    const nodes: Node<SdlNodeData>[] = [];
    const edges: Edge[] = [];

    let autoY = 40;

    function addNode(sym: SdlSymbol): void {
        let x = 0, y = 0, w = DEFAULT_WIDTH, h = DEFAULT_HEIGHT;
        if (sym.cif) {
            x = sym.cif.x; y = sym.cif.y; w = sym.cif.w; h = sym.cif.h;
        } else {
            y = autoY;
            autoY += h + AUTO_GAP;
        }

        nodes.push({
            id: sym.id,
            type: SDL_SYMBOL_NODE,
            position: { x, y },
            data: { kind: sym.kind, text: sym.text, options },
            style: { width: w, height: h },
            width: w,
            height: h,
        });
    }

    function edgeId(a: string, b: string): string { return `${a}--${b}`; }

    function addSequentialEdges(children: SdlSymbol[]): void {
        let prev: SdlSymbol | null = null;
        for (const child of children) {
            if (child.kind === 'comment') {
                // Dashed edge from comment to previous symbol
                if (prev) {
                    edges.push({
                        id: edgeId(child.id, prev.id),
                        source: child.id,
                        target: prev.id,
                        type: 'straight',
                        style: { strokeDasharray: '4 4', stroke: '#6c7086' },
                        animated: false,
                    });
                }
            } else {
                if (prev && prev.kind !== 'comment') {
                    edges.push({
                        id: edgeId(prev.id, child.id),
                        source: prev.id,
                        target: child.id,
                        type: 'straight',
                        markerEnd: { type: MarkerType.ArrowClosed },
                    });
                }
                prev = child;
            }
        }
    }

    function walkTree(symbols: SdlSymbol[]): void {
        for (const sym of symbols) {
            addNode(sym);

            switch (sym.kind) {
                case 'state':
                case 'stateAggregation':
                    // State → each Input / ContinuousSignal
                    for (const child of sym.children) {
                        addNode(child);
                        edges.push({
                            id: edgeId(sym.id, child.id),
                            source: sym.id,
                            target: child.id,
                            type: 'straight',
                            markerEnd: { type: MarkerType.ArrowClosed },
                        });
                        // Recurse into Input's action sequence
                        addSequentialEdges(child.children);
                        walkTree(child.children);
                    }
                    break;

                case 'decision':
                case 'alternative':
                    // Decision/Alternative → each Answer
                    for (const answer of sym.children) {
                        addNode(answer);
                        edges.push({
                            id: edgeId(sym.id, answer.id),
                            source: sym.id,
                            target: answer.id,
                            type: 'straight',
                            markerEnd: { type: MarkerType.ArrowClosed },
                        });
                        // Answer's children are an action sequence
                        addSequentialEdges(answer.children);
                        walkTree(answer.children);
                    }
                    break;

                case 'procedure':
                    addSequentialEdges(sym.children);
                    walkTree(sym.children);
                    break;

                default:
                    // Terminal or unknown — no children
                    break;
            }
        }
    }

    // Process-level: nodes are laid out by CIF coordinates.
    // Draw sequential edges among non-state, non-procedure, non-textArea siblings
    // that form the initial transition (between START and first NEXTSTATE).
    walkTree(sdl.tree);
    drawInitialTransitionEdges(sdl.tree, edges);

    return { nodes, edges };
}

/**
 * Connect START → first action → ... → NEXTSTATE in the process-level sequence.
 * Stops at the first STATE, PROCEDURE, or TEXT AREA symbol.
 */
function drawInitialTransitionEdges(tree: SdlSymbol[], edges: Edge[]): void {
    const ACTION_KINDS: SdlSymbolKind[] = [
        'start', 'task', 'output', 'procedureCall', 'decision', 'alternative',
        'nextstate', 'join', 'label', 'connect', 'return', 'comment',
    ];

    const sequence = tree.filter(s => ACTION_KINDS.includes(s.kind));
    let prev: SdlSymbol | null = null;
    for (const sym of sequence) {
        if (sym.kind === 'comment') {
            if (prev) {
                const eid = `cmt-${sym.id}-${prev.id}`;
                if (!edges.find(e => e.id === eid)) {
                    edges.push({
                        id: eid,
                        source: sym.id,
                        target: prev.id,
                        type: 'straight',
                        style: { strokeDasharray: '4 4', stroke: '#6c7086' },
                    });
                }
            }
        } else {
            if (prev && prev.kind !== 'comment') {
                const eid = `init-${prev.id}-${sym.id}`;
                if (!edges.find(e => e.id === eid)) {
                    edges.push({
                        id: eid,
                        source: prev.id,
                        target: sym.id,
                        type: 'straight',
                        markerEnd: { type: MarkerType.ArrowClosed },
                    });
                }
            }
            prev = sym;
        }
    }
}

// ── Symbol fill color ───────────────────────────────────────────────────────

export function sdlFillColor(kind: SdlSymbolKind, options: EditorOptions): string {
    switch (kind) {
        case 'state':
        case 'stateAggregation':  return options.sdlStateColor;
        case 'input':             return options.sdlInputColor;
        case 'continuousSignal':  return options.sdlInputColor;
        case 'output':            return options.sdlOutputColor;
        case 'task':              return options.sdlTaskColor;
        case 'decision':
        case 'alternative':       return options.sdlDecisionColor;
        case 'procedure':
        case 'procedureCall':     return options.sdlProcedureColor;
        case 'start':
        case 'nextstate':
        case 'return':            return options.sdlStartColor;
        case 'comment':           return options.sdlCommentColor;
        case 'textArea':          return options.sdlTextAreaColor;
        default:                  return options.sdlDefaultFillColor;
    }
}
