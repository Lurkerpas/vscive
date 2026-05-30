/**
 * SDL .pr file in-place patcher (serializer).
 *
 * REQ-0741: Only CIF coordinate comments and symbol text spans are updated on
 * save; everything else is preserved verbatim.
 */

import type { SdlCifCoords, SdlModel, SdlSymbol } from '../model/types';
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
