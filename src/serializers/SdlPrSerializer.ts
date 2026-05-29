/**
 * SDL .pr file in-place patcher (serializer).
 *
 * REQ-0741: Only CIF coordinate comments and symbol text spans are updated on
 * save; everything else is preserved verbatim.
 */

import type { SdlCifCoords, SdlModel, SdlSymbol } from '../model/types';
import { flattenSymbols } from '../parsers/SdlPrParser';

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
