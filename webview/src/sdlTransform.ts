/**
 * Converts a flat list of SdlSymbols (one navigation level) into ReactFlow
 * nodes and edges.  The caller controls the level by passing the appropriate
 * flat list; this function does NOT recurse into children.
 */

import { Edge, MarkerType, Node } from '@xyflow/react';
import { EditorOptions, SdlSymbol, SdlSymbolKind } from '../../src/model/types';

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
    hasChildren: boolean;
}

// ── Edge strategy ────────────────────────────────────────────────────────────

/**
 * Whether to draw sequential flow edges between siblings at a given level.
 * State children (inputs) and decision children (answers) are triggered
 * independently and need no inter-sibling edges.
 */
function shouldDrawSequential(parentKind: SdlSymbolKind | null): boolean {
    if (parentKind === 'state')            return false;
    if (parentKind === 'stateAggregation') return false;
    if (parentKind === 'decision')         return false;
    if (parentKind === 'alternative')      return false;
    return true;
}

/**
 * At process level only these kinds are part of the sequential initial
 * transition; state, procedure, and textArea are isolated nodes.
 */
const TRANSITION_KINDS = new Set<SdlSymbolKind>([
    'start', 'task', 'output', 'procedureCall', 'decision', 'alternative',
    'answer', 'nextstate', 'join', 'label', 'connect', 'return',
    'input', 'continuousSignal',
]);

// ── Build graph ─────────────────────────────────────────────────────────────

/**
 * Build a ReactFlow graph from a FLAT list of SDL symbols at the current
 * navigation level.
 *
 * @param symbols     Flat symbol list for the current level (no recursion).
 * @param parentKind  Kind of the container symbol, or null at process level.
 * @param options     Editor visual options.
 */
export function buildSdlGraph(
    symbols: SdlSymbol[],
    parentKind: SdlSymbolKind | null,
    options: EditorOptions,
): { nodes: Node<SdlNodeData>[]; edges: Edge[] } {
    const nodes: Node<SdlNodeData>[] = [];
    const edges: Edge[] = [];
    let autoY = 40;

    const edgeStyle = {
        stroke: options.sdlConnectionColor,
        strokeWidth: options.sdlConnectionThickness,
    };
    const markerEnd = {
        type: MarkerType.ArrowClosed,
        color: options.sdlConnectionColor,
    };

    // ── Helpers ─────────────────────────────────────────────────────────────
    function pushNode(sym: SdlSymbol, navigable: boolean): void {
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
            data: { kind: sym.kind, text: sym.text, options, hasChildren: navigable && sym.children.length > 0 },
            style: { width: w, height: h },
            width: w,
            height: h,
        });
    }

    function pushEdge(srcId: string, tgtId: string, prefix = 'br'): void {
        edges.push({
            id: `${prefix}-${srcId}--${tgtId}`,
            source: srcId,
            target: tgtId,
            type: 'smoothstep',
            style: edgeStyle,
            markerEnd,
        });
    }

    /**
     * Render a sequence of action symbols (task, output, procedureCall, decision, …)
     * starting from prevId.  Decisions are inlined; sequential flow continues
     * past each decision to handle cases like two consecutive decisions.
     */
    function unfoldActionSequence(children: SdlSymbol[], startPrevId: string): void {
        let prevId = startPrevId;
        for (const action of children) {
            if (action.kind === 'comment') continue;
            const isDecision = action.kind === 'decision' || action.kind === 'alternative';
            pushNode(action, !isDecision);
            pushEdge(prevId, action.id);
            prevId = action.id;
            if (isDecision) {
                // Branches are rendered inline; sequential flow continues after.
                unfoldDecision(action);
            }
        }
    }

    /**
     * Inline-unfold a decision / alternative:
     * decision → answer → [action sequence…]
     * Nested decisions are handled recursively via unfoldActionSequence.
     */
    function unfoldDecision(decSym: SdlSymbol): void {
        for (const answer of decSym.children) {
            if (answer.kind === 'comment') continue;
            pushNode(answer, false);
            pushEdge(decSym.id, answer.id);
            unfoldActionSequence(answer.children, answer.id);
        }
    }

    /**
     * Inline-unfold a state: state → input/continuousSignal → [action sequence…]
     * Other child kinds (textArea, comment) are ignored at this level.
     */
    function unfoldState(stateSym: SdlSymbol): void {
        for (const handler of stateSym.children) {
            if (handler.kind !== 'input' && handler.kind !== 'continuousSignal' && handler.kind !== 'connect') continue;
            pushNode(handler, false);
            pushEdge(stateSym.id, handler.id);
            unfoldActionSequence(handler.children, handler.id);
        }
    }

    // ── Nodes ───────────────────────────────────────────────────────────────
    for (const sym of symbols) {
        if (sym.kind === 'comment') continue;
        const isDecision = sym.kind === 'decision' || sym.kind === 'alternative';
        const isState    = sym.kind === 'state';    // stateAggregation stays navigable
        pushNode(sym, !isDecision && !isState);
        if (isDecision)  unfoldDecision(sym);
        else if (isState) unfoldState(sym);
    }

    // ── Edges ───────────────────────────────────────────────────────────────
    if (!shouldDrawSequential(parentKind)) return { nodes, edges };

    // At process level: only wire transition-kind symbols together.
    // At other levels: wire all siblings sequentially.
    // Comment symbols are never rendered, so exclude them from both lists.
    const connectible = (parentKind === null
        ? symbols.filter(s => TRANSITION_KINDS.has(s.kind))
        : symbols
    ).filter(s => s.kind !== 'comment');

    let prev: SdlSymbol | null = null;
    for (const sym of connectible) {
        if (prev) {
            pushEdge(prev.id, sym.id, 'seq');
        }
        prev = sym;
    }

    return { nodes, edges };
}

// ── Symbol fill color ───────────────────────────────────────────────────────

export function sdlFillColor(kind: SdlSymbolKind, options: EditorOptions): string {
    switch (kind) {
        case 'state':
        case 'stateAggregation':  return options.sdlStateColor;
        case 'input':
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
