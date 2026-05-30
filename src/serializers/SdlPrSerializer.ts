/**
 * SDL .pr file in-place patcher (serializer).
 *
 * REQ-0741: Only CIF coordinate comments and symbol text spans are updated on
 * save; everything else is preserved verbatim.
 */

import type { SdlCifCoords, SdlInsertKind, SdlModel, SdlSymbol } from '../model/types';
import {
    SDL_CANVAS_INSERT_TYPES,
    SDL_DECISION_BRANCH_HORIZONTAL_DELTA,
    SDL_FOLLOW_INSERT_TYPES_BY_SYMBOL,
} from '../model/sdlInsertRules';
import { flattenSymbols, parsePr } from '../parsers/SdlPrParser';

// ── CIF comment formatting ──────────────────────────────────────────────────

/** Build a new CIF coordinate comment with the given kind name and coordinates. */
export function formatCifComment(cifKind: string, coords: SdlCifCoords, indent = ''): string {
    const { x, y, w, h } = coords;
    return `${indent}/* CIF ${cifKind} (${x}, ${y}), (${w}, ${h}) */`;
}

/** Extract the CIF kind name from a raw CIF comment string. */
function extractCifKindRaw(cifRaw: string): string {
    const m = /\/\*\s*CIF\s+(\w+)/i.exec(cifRaw);
    return m ? m[1] : 'UNKNOWN';
}

// ── Patch application ───────────────────────────────────────────────────────

interface CifPatch {
    kind: 'cif';
    lineIndex: number;
    newText: string;
}

interface TextPatch {
    kind: 'text';
    lineStart: number; // inclusive, 0-based
    lineEnd: number;   // exclusive, 0-based
    newLines: string[];
}

type Patch = CifPatch | TextPatch;

function collectPatches(original: SdlModel, modified: SdlModel): Patch[] {
    const patches: Patch[] = [];
    const origFlat = flattenSymbols(original.tree);
    const modFlat  = flattenSymbols(modified.tree);

    // Map original symbols by id
    const origById = new Map<string, SdlSymbol>();
    for (const s of origFlat) origById.set(s.id, s);

    for (const modSym of modFlat) {
        const origSym = origById.get(modSym.id);
        if (!origSym) continue;

        // CIF coordinate changed?
        if (
            modSym.cif !== null &&
            modSym.cifLine !== null &&
            origSym.cif !== null &&
            (modSym.cif.x !== origSym.cif.x || modSym.cif.y !== origSym.cif.y ||
             modSym.cif.w !== origSym.cif.w || modSym.cif.h !== origSym.cif.h)
        ) {
            patches.push({
                kind: 'cif',
                lineIndex: modSym.cifLine,
                newText: formatCifComment(
                    extractCifKindRaw(modSym.cifRaw),
                    modSym.cif,
                    detectLineIndent(original.lines, modSym.cifLine),
                ),
            });
        }

        // Text content changed?
        if (modSym.text !== origSym.text) {
            const newLines = modSym.text.split('\n');
            patches.push({
                kind: 'text',
                lineStart: modSym.textLineStart,
                lineEnd: modSym.textLineEnd,
                newLines,
            });
        }
    }

    return patches;
}

/**
 * Apply all patches to `model.lines` and return the resulting file content.
 * Patches are applied in reverse line order to preserve line indices.
 */
export function patchPr(original: SdlModel, modified: SdlModel): string {
    const patches = collectPatches(original, modified);
    const lines = [...modified.lines];

    // Sort descending by line index so later patches don't shift earlier indices
    patches.sort((a, b) => {
        const lineA = a.kind === 'cif' ? a.lineIndex : a.lineStart;
        const lineB = b.kind === 'cif' ? b.lineIndex : b.lineStart;
        return lineB - lineA;
    });

    for (const patch of patches) {
        if (patch.kind === 'cif') {
            if (patch.lineIndex >= 0 && patch.lineIndex < lines.length) {
                lines[patch.lineIndex] = patch.newText;
            }
        } else {
            const start = Math.max(0, patch.lineStart);
            const end   = Math.min(lines.length, patch.lineEnd);
            lines.splice(start, end - start, ...patch.newLines);
        }
    }

    return lines.join('\n');
}

/**
 * Mutate `model.lines` to reflect a symbol CIF coordinate change.
 * Called by the document when a node is moved/resized in the webview.
 */
export function applySymbolMove(model: SdlModel, sym: SdlSymbol, x: number, y: number, w: number, h: number): void {
    if (sym.cifLine === null) return;
    sym.cif = { x, y, w, h };
    const newComment = formatCifComment(
        extractCifKindRaw(sym.cifRaw),
        sym.cif,
        detectLineIndent(model.lines, sym.cifLine),
    );
    if (sym.cifLine >= 0 && sym.cifLine < model.lines.length) {
        model.lines[sym.cifLine] = newComment;
    }
    sym.cifRaw = newComment;
}

/**
 * Mutate `model.lines` to reflect a symbol text edit.
 */
export function applySymbolTextEdit(model: SdlModel, sym: SdlSymbol, newText: string): void {
    const start = Math.max(0, sym.textLineStart);
    const end   = Math.min(model.lines.length, sym.textLineEnd);
    const oldLineCount = end - start;
    const indent = detectIndent(model.lines, start, end);
    const newLines = newText.split('\n').map(line => line.length > 0 ? `${indent}${line}` : line);
    model.lines.splice(start, end - start, ...newLines);

    // Adjust textLineEnd to reflect new span length
    const delta = newLines.length - oldLineCount;
    sym.text = newText;
    sym.textLineEnd = sym.textLineStart + newLines.length;

    // Shift all other symbols whose lines come after
    if (delta !== 0) {
        shiftSymbols(model.tree, end - 1, delta, sym.id);
    }
}

function detectIndent(lines: string[], start: number, end: number): string {
    for (let index = start; index < end; index++) {
        const line = lines[index] ?? '';
        if (line.trim().length === 0) {
            continue;
        }
        return /^\s*/.exec(line)?.[0] ?? '';
    }
    return '';
}

function detectLineIndent(lines: string[], lineIndex: number): string {
    const line = lines[lineIndex] ?? '';
    return /^\s*/.exec(line)?.[0] ?? '';
}

function shiftSymbols(symbols: SdlSymbol[], afterLine: number, delta: number, skipId: string): void {
    for (const s of symbols) {
        if (s.id === skipId) {
            shiftSymbols(s.children, afterLine, delta, skipId);
            shiftSymbols(s.nestedChildren, afterLine, delta, skipId);
            continue;
        }
        if (s.cifLine !== null && s.cifLine > afterLine) s.cifLine += delta;
        if (s.textLineStart > afterLine) {
            s.textLineStart += delta;
            s.textLineEnd   += delta;
        } else if (s.textLineEnd > afterLine) {
            s.textLineEnd   += delta;
        }
        shiftSymbols(s.children, afterLine, delta, skipId);
        shiftSymbols(s.nestedChildren, afterLine, delta, skipId);
    }
}

type SymbolContainerKind = 'tree' | 'children' | 'nestedChildren';

interface SymbolContext {
    symbol: SdlSymbol;
    parent: SdlSymbol | null;
    siblings: SdlSymbol[];
    indexInSiblings: number;
    containerKind: SymbolContainerKind;
}

interface DeleteRange {
    start: number;
    endExclusive: number;
}

function symbolStartLine(symbol: SdlSymbol): number {
    return symbol.cifLine ?? symbol.textLineStart;
}

function findSymbolContext(
    siblings: SdlSymbol[],
    id: string,
    parent: SdlSymbol | null,
    containerKind: SymbolContainerKind,
): SymbolContext | null {
    for (let index = 0; index < siblings.length; index++) {
        const symbol = siblings[index];
        if (symbol.id === id) {
            return { symbol, parent, siblings, indexInSiblings: index, containerKind };
        }

        const inChildren = findSymbolContext(symbol.children, id, symbol, 'children');
        if (inChildren) return inChildren;

        const inNestedChildren = findSymbolContext(symbol.nestedChildren, id, symbol, 'nestedChildren');
        if (inNestedChildren) return inNestedChildren;
    }
    return null;
}

function findFirstMatchingLineAfter(
    lines: string[],
    startLine: number,
    matchers: RegExp[],
): number | null {
    for (let line = Math.max(0, startLine + 1); line < lines.length; line++) {
        const text = lines[line] ?? '';
        if (matchers.some(matcher => matcher.test(text))) {
            return line;
        }
    }
    return null;
}

function findContainerEndLineExclusive(model: SdlModel, context: SymbolContext, startLine: number): number {
    const { parent, containerKind } = context;
    const lines = model.lines;

    let matchers: RegExp[] = [/^\s*endprocess\b/i];
    if (parent === null) {
        matchers = [/^\s*endprocess\b/i, /^\s*endsystem\b/i, /^\s*endblock\b/i, /^\s*endchannel\b/i];
    } else if (containerKind === 'nestedChildren') {
        matchers = [/^\s*endsubstructure\b/i, /^\s*endstate\b/i];
    } else {
        switch (parent.kind) {
            case 'state':
            case 'stateAggregation':
                matchers = [/^\s*endstate\b/i];
                break;
            case 'decision':
                matchers = [/^\s*enddecision\b/i];
                break;
            case 'alternative':
                matchers = [/^\s*endalternative\b/i];
                break;
            case 'procedure':
                matchers = [/^\s*endprocedure\b/i];
                break;
            case 'input':
                matchers = [/^\s*endinput\b/i, /^\s*endstate\b/i];
                break;
            case 'continuousSignal':
                matchers = [/^\s*endprovided\b/i, /^\s*endstate\b/i];
                break;
            case 'connect':
                matchers = [/^\s*endconnection\b/i, /^\s*endstate\b/i];
                break;
            case 'answer':
                matchers = [/^\s*enddecision\b/i, /^\s*endalternative\b/i];
                break;
            default:
                matchers = [/^\s*endprocess\b/i];
                break;
        }
    }

    const boundaryLine = findFirstMatchingLineAfter(lines, startLine, matchers);
    return boundaryLine ?? lines.length;
}

function mergeRanges(ranges: DeleteRange[]): DeleteRange[] {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((left, right) => left.start - right.start);
    const merged: DeleteRange[] = [sorted[0]];

    for (let index = 1; index < sorted.length; index++) {
        const range = sorted[index];
        const tail = merged[merged.length - 1];
        if (range.start <= tail.endExclusive) {
            tail.endExclusive = Math.max(tail.endExclusive, range.endExclusive);
            continue;
        }
        merged.push({ ...range });
    }

    return merged;
}

export interface SdlInsertRequest {
    kind: SdlInsertKind;
    mode: 'canvas' | 'following';
    x: number;
    y: number;
    anchorId?: string;
    containerId?: string;
    containerKind?: SymbolContainerKind;
}

interface SymbolSize {
    w: number;
    h: number;
}

const SDL_INSERT_VERTICAL_GAP = 20;

function defaultSymbolSize(kind: SdlInsertKind): SymbolSize {
    switch (kind) {
        case 'start': return { w: 70, h: 35 };
        case 'state': return { w: 100, h: 35 };
        case 'input': return { w: 120, h: 35 };
        case 'continuousSignal': return { w: 120, h: 35 };
        case 'output': return { w: 120, h: 35 };
        case 'task': return { w: 120, h: 35 };
        case 'decision': return { w: 150, h: 50 };
        case 'alternative': return { w: 130, h: 50 };
        case 'nextstate': return { w: 90, h: 35 };
        case 'procedure': return { w: 120, h: 35 };
        case 'procedureCall': return { w: 140, h: 35 };
        case 'return': return { w: 35, h: 35 };
        case 'join': return { w: 35, h: 35 };
        case 'label': return { w: 80, h: 35 };
        case 'connect': return { w: 35, h: 35 };
        case 'comment': return { w: 140, h: 60 };
        case 'decisionAlternative': return { w: 95, h: 23 };
        default: return { w: 150, h: 60 };
    }
}

function insertionOffsetY(kind: SdlInsertKind): number {
    return defaultSymbolSize(kind).h + SDL_INSERT_VERTICAL_GAP;
}

function cifKindForInsert(kind: SdlInsertKind): string {
    switch (kind) {
        case 'continuousSignal': return 'PROVIDED';
        case 'procedureCall': return 'PROCEDURECALL';
        case 'decisionAlternative': return 'ANSWER';
        default: return kind.toUpperCase();
    }
}

function symbolTextTemplate(kind: SdlInsertKind): string[] {
    switch (kind) {
        case 'start': return ['START;'];
        case 'state': return ['state new_state;', 'endstate;'];
        case 'input': return ['input signal_name;'];
        case 'continuousSignal': return ['provided signal_name;'];
        case 'output': return ['output signal_name;'];
        case 'task': return ['task action;'];
        case 'decision': return ['decision condition;', 'enddecision;'];
        case 'alternative': return ['alternative condition;', 'endalternative;'];
        case 'nextstate': return ['nextstate new_state;'];
        case 'procedure': return ['procedure new_procedure;', 'endprocedure;'];
        case 'procedureCall': return ['call procedure_name;'];
        case 'return': return ['return;'];
        case 'join': return ['join new_join;'];
        case 'label': return ['connection new_label:'];
        case 'connect': return ['connect new_connection;'];
        case 'comment': return ["comment 'new comment';"];
        case 'decisionAlternative': return ['(else):'];
        default: return ['task action;'];
    }
}

function inferTopLevelIndent(model: SdlModel, processEndLine: number): string {
    for (const symbol of model.tree) {
        const line = symbol.cifLine ?? symbol.textLineStart;
        if (line >= 0 && line < model.lines.length) {
            const indent = detectLineIndent(model.lines, line);
            if (indent.length > 0) return indent;
        }
    }

    for (let line = processEndLine - 1; line >= 0; line--) {
        const text = model.lines[line] ?? '';
        if (text.trim().length === 0) continue;
        return /^\s*/.exec(text)?.[0] ?? '    ';
    }
    return '    ';
}

function findRootContainerEndLine(model: SdlModel): number {
    const rootEnd = findFirstMatchingLineAfter(
        model.lines,
        -1,
        [/^\s*endprocess\b/i, /^\s*endsystem\b/i, /^\s*endblock\b/i, /^\s*endchannel\b/i],
    );
    return rootEnd ?? model.lines.length;
}

function findProcessEndLine(model: SdlModel): number {
    if (model.tree.length > 0) {
        const lastSymbol = model.tree[model.tree.length - 1];
        const lastSymbolLine = symbolStartLine(lastSymbol);
        const endProcessAfterTree = findFirstMatchingLineAfter(
            model.lines,
            lastSymbolLine,
            [/^\s*endprocess\b/i],
        );
        if (endProcessAfterTree !== null) {
            return endProcessAfterTree;
        }
    }

    const processLine = model.lines.findIndex(line => /^\s*process\b/i.test(line));
    if (processLine >= 0) {
        const endProcessAfterDeclaration = findFirstMatchingLineAfter(
            model.lines,
            processLine,
            [/^\s*endprocess\b/i],
        );
        if (endProcessAfterDeclaration !== null) {
            return endProcessAfterDeclaration;
        }
    }

    return findRootContainerEndLine(model);
}

function resolveCanvasContainer(
    model: SdlModel,
    request: SdlInsertRequest,
): { endLine: number; indent: string } {
    if (!request.containerId || request.containerKind === 'tree' || request.containerKind === undefined) {
        const endLine = findProcessEndLine(model);
        return {
            endLine,
            indent: inferTopLevelIndent(model, endLine),
        };
    }

    const containerContext = findSymbolContext(model.tree, request.containerId, null, 'tree');
    if (!containerContext) {
        const endLine = findProcessEndLine(model);
        return {
            endLine,
            indent: inferTopLevelIndent(model, endLine),
        };
    }

    const containerSymbol = containerContext.symbol;
    const childList = request.containerKind === 'nestedChildren'
        ? containerSymbol.nestedChildren
        : containerSymbol.children;
    const endLine = findContainerEndLineExclusive(
        model,
        {
            symbol: containerSymbol,
            parent: containerSymbol,
            siblings: childList,
            indexInSiblings: Math.max(0, childList.length - 1),
            containerKind: request.containerKind,
        },
        symbolStartLine(containerSymbol),
    );

    if (childList.length > 0) {
        const tail = childList[childList.length - 1];
        return {
            endLine,
            indent: detectLineIndent(model.lines, tail.cifLine ?? tail.textLineStart),
        };
    }

    const containerIndent = detectLineIndent(model.lines, containerSymbol.cifLine ?? containerSymbol.textLineStart);
    return {
        endLine,
        indent: `${containerIndent}    `,
    };
}

function buildInsertedLines(kind: SdlInsertKind, x: number, y: number, indent: string): string[] {
    const size = defaultSymbolSize(kind);
    const safeX = Number.isFinite(x) ? Math.round(x) : 0;
    const safeY = Number.isFinite(y) ? Math.round(y) : 0;
    const cif = formatCifComment(cifKindForInsert(kind), {
        x: safeX,
        y: safeY,
        w: size.w,
        h: size.h,
    }, indent);
    const text = symbolTextTemplate(kind).map(line => `${indent}${line}`);
    return [cif, ...text];
}

function insertLines(model: SdlModel, lineIndex: number, newLines: string[]): void {
    const at = Math.max(0, Math.min(lineIndex, model.lines.length));
    model.lines.splice(at, 0, ...newLines);
}

function shiftSymbolSubtreeByY(model: SdlModel, symbol: SdlSymbol, deltaY: number): void {
    if (symbol.cif) {
        applySymbolMove(
            model,
            symbol,
            symbol.cif.x,
            symbol.cif.y + deltaY,
            symbol.cif.w,
            symbol.cif.h,
        );
    }

    for (const child of symbol.children) {
        shiftSymbolSubtreeByY(model, child, deltaY);
    }
    for (const child of symbol.nestedChildren) {
        shiftSymbolSubtreeByY(model, child, deltaY);
    }
}

function reparseModel(model: SdlModel): void {
    const reparsed = parsePr(model.lines.join('\n'));
    model.lines = reparsed.lines;
    model.tree = reparsed.tree;
}

function shouldInsertIntoAnchorChildren(anchorKind: SdlSymbol['kind'], kind: SdlInsertKind): boolean {
    if ((anchorKind === 'state' || anchorKind === 'stateAggregation')
        && (kind === 'input' || kind === 'continuousSignal' || kind === 'connect')) {
        return true;
    }

    if ((anchorKind === 'input' || anchorKind === 'continuousSignal' || anchorKind === 'connect' || anchorKind === 'answer' || anchorKind === 'procedure')
        && kind !== 'state') {
        return true;
    }

    return false;
}

function applyInsertIntoAnchorChildren(model: SdlModel, request: SdlInsertRequest, context: SymbolContext): void {
    const anchor = context.symbol;
    const childList = anchor.children;
    const syntheticContext: SymbolContext = {
        symbol: anchor,
        parent: anchor,
        siblings: childList,
        indexInSiblings: Math.max(0, childList.length - 1),
        containerKind: 'children',
    };

    const insertionLine = findContainerEndLineExclusive(model, syntheticContext, symbolStartLine(anchor));
    const offsetY = insertionOffsetY(request.kind);

    let baseX = anchor.cif?.x ?? request.x;
    let baseY = anchor.cif?.y ?? request.y;
    let indent = `${detectLineIndent(model.lines, anchor.cifLine ?? anchor.textLineStart)}    `;

    if (childList.length > 0) {
        const tail = childList[childList.length - 1];
        baseX = tail.cif?.x ?? baseX;
        baseY = tail.cif?.y ?? baseY;
        indent = detectLineIndent(model.lines, tail.cifLine ?? tail.textLineStart);
    }

    const inserted = buildInsertedLines(request.kind, baseX, baseY + offsetY, indent);
    insertLines(model, insertionLine, inserted);
}

function applyDecisionAlternativeInsert(model: SdlModel, request: SdlInsertRequest, context: SymbolContext): void {
    const decision = context.symbol;
    if (decision.kind !== 'decision' && decision.kind !== 'alternative') return;

    const followers = SDL_FOLLOW_INSERT_TYPES_BY_SYMBOL[decision.kind];
    if (!followers.includes('decisionAlternative')) return;

    const answers = decision.children.filter(child => child.kind === 'answer' && child.cif !== null);
    const answerIndent = answers.length > 0
        ? detectLineIndent(model.lines, answers[0].cifLine ?? answers[0].textLineStart)
        : `${detectLineIndent(model.lines, decision.cifLine ?? decision.textLineStart)}    `;
    const baseAnswerX = answers.length > 0
        ? Math.max(...answers.map(answer => answer.cif?.x ?? 0))
        : (decision.cif?.x ?? request.x);
    const answerY = answers.length > 0
        ? (answers[0].cif?.y ?? (decision.cif?.y ?? request.y) + 70)
        : ((decision.cif?.y ?? request.y) + 70);

    const endLine = findFirstMatchingLineAfter(
        model.lines,
        symbolStartLine(decision),
        decision.kind === 'decision'
            ? [/^\s*enddecision\b/i]
            : [/^\s*endalternative\b/i],
    ) ?? model.lines.length;

    const inserted = buildInsertedLines(
        'decisionAlternative',
        baseAnswerX + SDL_DECISION_BRANCH_HORIZONTAL_DELTA,
        answerY,
        answerIndent,
    );
    insertLines(model, endLine, inserted);
}

/**
 * Insert a new SDL symbol either on the current canvas level or after an anchor symbol.
 * The file is reparsed after insertion so symbol metadata remains consistent.
 */
export function applySymbolInsert(model: SdlModel, request: SdlInsertRequest): void {
    if (request.mode === 'canvas') {
        if (!SDL_CANVAS_INSERT_TYPES.includes(request.kind)) {
            return;
        }
        const { endLine, indent } = resolveCanvasContainer(model, request);
        const inserted = buildInsertedLines(request.kind, request.x, request.y, indent);
        insertLines(model, endLine, inserted);
        reparseModel(model);
        return;
    }

    if (!request.anchorId) {
        return;
    }

    const context = findSymbolContext(model.tree, request.anchorId, null, 'tree');
    if (!context) {
        return;
    }

    const allowedFollowers = SDL_FOLLOW_INSERT_TYPES_BY_SYMBOL[context.symbol.kind] ?? [];
    if (!allowedFollowers.includes(request.kind)) {
        return;
    }

    if (request.kind === 'decisionAlternative') {
        applyDecisionAlternativeInsert(model, request, context);
        reparseModel(model);
        return;
    }

    if (shouldInsertIntoAnchorChildren(context.symbol.kind, request.kind)) {
        applyInsertIntoAnchorChildren(model, request, context);
        reparseModel(model);
        return;
    }

    if (request.kind === 'state' && context.containerKind === 'children') {
        // State targets are valid in process/nested-state canvases, not inside child action lists.
        return;
    }

    const nextSibling = context.siblings[context.indexInSiblings + 1];
    const insertionLine = nextSibling
        ? symbolStartLine(nextSibling)
        : findContainerEndLineExclusive(model, context, symbolStartLine(context.symbol));
    const offsetY = insertionOffsetY(request.kind);

    if (nextSibling) {
        for (let index = context.indexInSiblings + 1; index < context.siblings.length; index++) {
            shiftSymbolSubtreeByY(model, context.siblings[index], offsetY);
        }
    }

    const anchorX = context.symbol.cif?.x ?? request.x;
    const anchorY = context.symbol.cif?.y ?? request.y;
    const indent = detectLineIndent(model.lines, context.symbol.cifLine ?? context.symbol.textLineStart);
    const inserted = buildInsertedLines(request.kind, anchorX, anchorY + offsetY, indent);
    insertLines(model, insertionLine, inserted);
    reparseModel(model);
}

/**
 * Delete one or more symbols from an SDL model by removing their source line spans
 * and reparsing the model to rebuild consistent symbol metadata.
 */
export function applySymbolsDelete(model: SdlModel, ids: string[]): void {
    if (ids.length === 0) return;

    const ranges: DeleteRange[] = [];
    for (const id of ids) {
        const context = findSymbolContext(model.tree, id, null, 'tree');
        if (!context) continue;

        const start = Math.max(0, symbolStartLine(context.symbol));
        const nextSibling = context.siblings[context.indexInSiblings + 1];
        const endExclusive = nextSibling
            ? Math.max(start, symbolStartLine(nextSibling))
            : Math.max(start, findContainerEndLineExclusive(model, context, start));

        if (endExclusive > start) {
            ranges.push({ start, endExclusive });
        }
    }

    const merged = mergeRanges(ranges);
    for (let index = merged.length - 1; index >= 0; index--) {
        const range = merged[index];
        model.lines.splice(range.start, range.endExclusive - range.start);
    }

    const reparsed = parsePr(model.lines.join('\n'));
    model.lines = reparsed.lines;
    model.tree = reparsed.tree;
}
