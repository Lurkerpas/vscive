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

export interface SdlEdgeData {
    kind: 'vertical' | 'rake';
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

    const isInlineDecision = (sym: SdlSymbol): boolean =>
        sym.kind === 'decision' || sym.kind === 'alternative';

    const isStateHandler = (sym: SdlSymbol): boolean =>
        sym.kind === 'input' || sym.kind === 'continuousSignal' || sym.kind === 'connect';

    const isExecutionBreak = (sym: SdlSymbol): boolean =>
        sym.kind === 'nextstate' || sym.kind === 'join' || sym.kind === 'return';

    const isFloatingLabel = (sym: SdlSymbol): boolean =>
        sym.kind === 'label' && /^connection\b/i.test(sym.text.trim());

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

    function pushEdge(srcId: string, tgtId: string, prefix = 'br', kind: SdlEdgeData['kind'] = 'vertical'): void {
        edges.push({
            id: `${prefix}-${srcId}--${tgtId}`,
            source: srcId,
            target: tgtId,
            type: 'sdlEdge',
            style: edgeStyle,
            markerEnd,
            data: { kind } satisfies SdlEdgeData,
        });
    }

    function pushActionNodes(children: SdlSymbol[]): void {
        for (const action of children) {
            if (action.kind === 'comment') continue;
            pushNode(action, !isInlineDecision(action));
            if (isInlineDecision(action)) {
                pushDecisionNodes(action);
            }
        }
    }

    function pushDecisionNodes(decSym: SdlSymbol): void {
        for (const answer of decSym.children) {
            if (answer.kind === 'comment') continue;
            pushNode(answer, false);
            pushActionNodes(answer.children);
        }
    }

    function pushStateNodes(stateSym: SdlSymbol): void {
        for (const handler of stateSym.children) {
            if (!isStateHandler(handler)) continue;
            pushNode(handler, false);
            pushActionNodes(handler.children);
        }
    }

    function renderActionFlow(action: SdlSymbol): string[] {
        if (isInlineDecision(action)) {
            return renderDecisionFlow(action);
        }
        return isExecutionBreak(action) ? [] : [action.id];
    }

    function renderActionSequence(children: SdlSymbol[], incomingIds: string[]): string[] {
        let openExits = [...incomingIds];
        for (let index = 0; index < children.length; index++) {
            const action = children[index];
            if (action.kind === 'comment') continue;

            if (isFloatingLabel(action)) {
                index = renderFloatingLabelSequence(children, index) - 1;
                continue;
            }

            for (const srcId of openExits) {
                pushEdge(srcId, action.id, 'seq', 'vertical');
            }
            openExits = renderActionFlow(action);
        }
        return openExits;
    }

    function renderFloatingLabelSequence(children: SdlSymbol[], startIndex: number): number {
        let branchOpenExits = [children[startIndex].id];
        let index = startIndex + 1;

        while (index < children.length) {
            const action = children[index];
            if (action.kind === 'comment') {
                index++;
                continue;
            }
            if (isFloatingLabel(action)) {
                break;
            }

            for (const srcId of branchOpenExits) {
                pushEdge(srcId, action.id, 'seq', 'vertical');
            }
            branchOpenExits = renderActionFlow(action);
            index++;

            if (branchOpenExits.length === 0) {
                break;
            }
        }

        return index;
    }

    function renderDecisionFlow(decSym: SdlSymbol): string[] {
        const openExits: string[] = [];
        for (const answer of decSym.children) {
            if (answer.kind === 'comment') continue;
            pushEdge(decSym.id, answer.id, 'br', 'rake');
            const branchExits = renderActionSequence(answer.children, [answer.id]);
            openExits.push(...branchExits);
        }
        return openExits;
    }

    function renderStateFlow(stateSym: SdlSymbol): void {
        for (const handler of stateSym.children) {
            if (!isStateHandler(handler)) continue;
            pushEdge(stateSym.id, handler.id, 'br', 'rake');
            renderActionSequence(handler.children, [handler.id]);
        }
    }

    // ── Nodes ───────────────────────────────────────────────────────────────
    for (const sym of symbols) {
        if (sym.kind === 'comment') continue;
        const isState    = sym.kind === 'state';    // stateAggregation stays navigable
        pushNode(sym, !isInlineDecision(sym) && !isState);
        if (isInlineDecision(sym)) pushDecisionNodes(sym);
        else if (isState) pushStateNodes(sym);
    }

    // ── Edges ───────────────────────────────────────────────────────────────
    for (const sym of symbols) {
        if (sym.kind === 'state') {
            renderStateFlow(sym);
        }
    }

    if (!shouldDrawSequential(parentKind)) return { nodes, edges };

    // At process level: only wire transition-kind symbols together.
    // At other levels: wire all siblings sequentially.
    // Comment symbols are never rendered, so exclude them from both lists.
    const connectible = (parentKind === null
        ? symbols.filter(s => TRANSITION_KINDS.has(s.kind))
        : symbols
    ).filter(s => s.kind !== 'comment');

    renderActionSequence(connectible, []);

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
