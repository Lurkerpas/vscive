/**
 * SDL .pr file parser.
 *
 * Uses typescript-parsec's buildLexer for tokenisation, then a manual
 * recursive-descent pass on the resulting token stream.
 *
 * The parser is lenient: unknown or unrecognised constructs are skipped
 * so that every valid .pr file can be loaded without errors.
 */

import { buildLexer, Token } from 'typescript-parsec';
import type { SdlCifCoords, SdlModel, SdlSymbol, SdlSymbolKind } from '../model/types';

// ── Token kinds ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-namespace
const enum TK {
    // CIF annotation comments (highest priority)
    CifCoord   = 0,   // /* CIF WORD (x, y), (w, h) */
    CifEndText = 1,   // /* CIF ENDTEXT */
    CifKeep    = 2,   // /* CIF Keep ... */
    // Other comments (skip)
    BlockCmt   = 3,
    LineCmt    = 4,
    // String literals (kept to prevent keyword matches inside strings)
    StrLit     = 5,
    // END keywords (before their non-end base keywords)
    KwEndProcess      = 6,
    KwEndState        = 7,
    KwEndSubstructure = 8,
    KwEndInput        = 9,
    KwEndProvided     = 10,
    KwEndDecision     = 11,
    KwEndAlternative  = 12,
    KwEndProcedure    = 13,
    KwEndText         = 14,
    KwEndSystem       = 15,
    KwEndBlock        = 16,
    KwEndChannel      = 17,
    // Structural keywords
    KwProcess     = 18,
    KwSystem      = 19,
    KwBlock       = 20,
    KwChannel     = 21,
    KwSignalRoute = 22,
    KwState       = 23,
    KwAggregation = 24,
    KwSubstructure= 25,
    KwInput       = 26,
    KwProvided    = 27,
    KwStart       = 28,
    KwTask        = 29,
    KwOutput      = 30,
    KwNextstate   = 31,
    KwDecision    = 32,
    KwAlternative = 33,
    KwProcedure   = 34,
    KwCall        = 35,
    KwReturn      = 36,
    KwJoin        = 37,
    KwLabel       = 38,
    KwConnect     = 39,
    KwComment     = 40,
    KwText        = 41,
    // Punctuation
    Lparen    = 42,
    Rparen    = 43,
    Semicolon = 44,
    // Generic
    Ident    = 45,
    Number   = 46,
    Newline  = 47,
    Other    = 48,
}

/** buildLexer requires patterns anchored with ^ at the start of each attempt. */
const LEXER = buildLexer<TK>([
    // CIF annotations – must be before generic block-comment rule
    [true,  /^\/\*\s*CIF\s+ENDTEXT\s*\*\//gi,                                     TK.CifEndText],
    [true,  /^\/\*\s*CIF\s+Keep[^\n*]*(?:\*(?!\/)[^\n*]*)*\*\//gi,               TK.CifKeep],
    [true,  /^\/\*\s*CIF\s+\w+\s+\(-?\d+\s*,\s*-?\d+\s*\)\s*,\s*\(\s*\d+\s*,\s*\d+\s*\)\s*\*\//gi, TK.CifCoord],
    // Other block / line comments (skip)
    [false, /^\/\*[\s\S]*?\*\//g,  TK.BlockCmt],
    [false, /^--[^\n]*/g,          TK.LineCmt],
    // String literals (keep to avoid keyword matches inside)
    [true,  /^'[^']*(?:''[^']*)*'/g, TK.StrLit],
    // END keywords BEFORE their shorter counterparts
    [true, /^endprocess\b/gi,      TK.KwEndProcess],
    [true, /^endstate\b/gi,        TK.KwEndState],
    [true, /^endsubstructure\b/gi, TK.KwEndSubstructure],
    [true, /^endinput\b/gi,        TK.KwEndInput],
    [true, /^endprovided\b/gi,     TK.KwEndProvided],
    [true, /^enddecision\b/gi,     TK.KwEndDecision],
    [true, /^endalternative\b/gi,  TK.KwEndAlternative],
    [true, /^endprocedure\b/gi,    TK.KwEndProcedure],
    [true, /^endtext\b/gi,         TK.KwEndText],
    [true, /^endsystem\b/gi,       TK.KwEndSystem],
    [true, /^endblock\b/gi,        TK.KwEndBlock],
    [true, /^endchannel\b/gi,      TK.KwEndChannel],
    // Regular keywords
    [true, /^process\b/gi,     TK.KwProcess],
    [true, /^system\b/gi,      TK.KwSystem],
    [true, /^block\b/gi,       TK.KwBlock],
    [true, /^channel\b/gi,     TK.KwChannel],
    [true, /^signalroute\b/gi, TK.KwSignalRoute],
    [true, /^state\b/gi,       TK.KwState],
    [true, /^aggregation\b/gi, TK.KwAggregation],
    [true, /^substructure\b/gi,TK.KwSubstructure],
    [true, /^input\b/gi,       TK.KwInput],
    [true, /^provided\b/gi,    TK.KwProvided],
    [true, /^start\b/gi,       TK.KwStart],
    [true, /^task\b/gi,        TK.KwTask],
    [true, /^output\b/gi,      TK.KwOutput],
    [true, /^nextstate\b/gi,   TK.KwNextstate],
    [true, /^decision\b/gi,    TK.KwDecision],
    [true, /^alternative\b/gi, TK.KwAlternative],
    [true, /^procedure\b/gi,   TK.KwProcedure],
    [true, /^call\b/gi,        TK.KwCall],
    [true, /^return\b/gi,      TK.KwReturn],
    [true, /^join\b/gi,        TK.KwJoin],
    [true, /^label\b/gi,       TK.KwLabel],
    [true, /^connect\b/gi,     TK.KwConnect],
    [true, /^comment\b/gi,     TK.KwComment],
    [true, /^text\b/gi,        TK.KwText],
    // Punctuation
    [true, /^\(/g, TK.Lparen],
    [true, /^\)/g, TK.Rparen],
    [true, /^;/g,  TK.Semicolon],
    // Identifiers and numbers
    [true, /^[a-zA-Z_]\w*/g, TK.Ident],
    [true, /^\d+/g,           TK.Number],
    // Whitespace: skip spaces/tabs/CR; keep newlines for line tracking
    [false, /^[ \t\r]+/g,  TK.Other],
    [true,  /^\n/g,         TK.Newline],
    // Catch-all
    [true, /^[\s\S]/g, TK.Other],
]);

// ── Token flat array ────────────────────────────────────────────────────────

interface Tok { kind: TK; text: string; line: number; }

function tokenize(source: string): Tok[] {
    const result: Tok[] = [];
    let t: Token<TK> | undefined = LEXER.parse(source);
    while (t) {
        result.push({ kind: t.kind, text: t.text, line: t.pos.rowBegin - 1 /* 0-based */ });
        t = t.next;
    }
    return result;
}

// ── Parser state ────────────────────────────────────────────────────────────

class Cursor {
    pos = 0;
    constructor(readonly tokens: Tok[]) {}

    peek(offset = 0): Tok | undefined { return this.tokens[this.pos + offset]; }
    consume(): Tok | undefined { return this.tokens[this.pos++]; }
    at(offset: number): Tok | undefined { return this.tokens[this.pos + offset]; }

    is(...kinds: TK[]): boolean {
        const t = this.tokens[this.pos];
        return t !== undefined && kinds.includes(t.kind);
    }

    /** Advance past tokens that are not in `stopKinds` and not CIF annotations. */
    skipUntil(...stopKinds: TK[]): void {
        while (this.pos < this.tokens.length) {
            const k = this.tokens[this.pos].kind;
            if (stopKinds.includes(k) || k === TK.CifCoord || k === TK.CifEndText || k === TK.CifKeep) break;
            this.pos++;
        }
    }

    /** Line number of the current token (0-based), or -1 if exhausted. */
    get line(): number { return this.tokens[this.pos]?.line ?? -1; }
}

let _idCounter = 0;
function nextId(): string { return `sdl-${++_idCounter}`; }

// ── CIF parsing helpers ─────────────────────────────────────────────────────

const CIF_COORD_RE = /\/\*\s*CIF\s+(\w+)\s+\((-?\d+)\s*,\s*(-?\d+)\s*\)\s*,\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*\*\//i;

function parseCifCoords(raw: string): { kind: string; coords: SdlCifCoords } | null {
    const m = CIF_COORD_RE.exec(raw);
    if (!m) return null;
    return {
        kind: m[1].toLowerCase(),
        coords: { x: +m[2], y: +m[3], w: +m[4], h: +m[5] },
    };
}

/** Map CIF keyword + following SDL keyword to SdlSymbolKind. */
function cifKindToSymbolKind(cifKind: string, nextTkKind: TK | undefined): SdlSymbolKind | null {
    switch (cifKind) {
        case 'start':         return 'start';
        case 'state':         return nextTkKind === TK.KwAggregation ? null /* handled below */ : 'state';
        case 'stateaggregation': return 'stateAggregation';
        case 'input':         return 'input';
        case 'provided':      return 'continuousSignal';
        case 'task':          return 'task';
        case 'output':        return 'output';
        case 'decision':      return 'decision';
        case 'answer':        return 'answer';
        case 'alternative':   return 'alternative';
        case 'nextstate':     return 'nextstate';
        case 'procedure':     return 'procedure';
        case 'procedurecall': return 'procedureCall';
        case 'call':          return 'procedureCall';
        case 'return':        return 'return';
        case 'join':          return 'join';
        case 'label':         return 'label';
        case 'connect':       return 'connect';
        case 'comment':       return 'comment';
        case 'text':          return 'textArea';
        default:              return null;
    }
}

// ── Text span extraction ────────────────────────────────────────────────────

/**
 * For a symbol whose keyword is at `kwLine`, collect text lines until the
 * next CIF comment, CIF ENDTEXT, or one of the `stopKinds` keyword lines.
 * Returns [textLineStart, textLineEnd] as 0-based, textLineEnd exclusive.
 */
function textSpan(tokens: Tok[], kwIdx: number, lines: string[]): [number, number] {
    const kwLine = tokens[kwIdx]?.line ?? 0;
    // Find the next CIF or END token after kwIdx
    for (let i = kwIdx + 1; i < tokens.length; i++) {
        const k = tokens[i].kind;
        if (k === TK.CifCoord || k === TK.CifEndText || k === TK.CifKeep) {
            return [kwLine, tokens[i].line];
        }
        if (isEndKeyword(k)) {
            return [kwLine, tokens[i].line];
        }
    }
    return [kwLine, lines.length];
}

const END_KEYWORDS: TK[] = [
    TK.KwEndProcess, TK.KwEndState, TK.KwEndSubstructure,
    TK.KwEndInput, TK.KwEndProvided, TK.KwEndDecision,
    TK.KwEndAlternative, TK.KwEndProcedure, TK.KwEndText,
    TK.KwEndSystem, TK.KwEndBlock, TK.KwEndChannel,
];

function isEndKeyword(k: TK): boolean {
    return END_KEYWORDS.includes(k);
}

// ── Recursive descent ───────────────────────────────────────────────────────

/**
 * Parse a list of CIF-annotated symbols until one of `stopKinds` is found
 * (or end of token stream).  Non-CIF content is skipped.
 */
function parseSymbolList(
    cursor: Cursor,
    lines: string[],
    stopKinds: TK[],
    recurse: (kind: SdlSymbolKind, cursor: Cursor, lines: string[], sym: SdlSymbol) => void,
): SdlSymbol[] {
    const symbols: SdlSymbol[] = [];

    while (cursor.pos < cursor.tokens.length) {
        if (cursor.is(...stopKinds)) break;

        const tok = cursor.peek()!;

        if (tok.kind === TK.CifEndText || tok.kind === TK.CifKeep) {
            cursor.consume();
            continue;
        }

        if (tok.kind !== TK.CifCoord) {
            cursor.consume();
            continue;
        }

        // ── Found a CIF annotation ───────────────────────────────────────
        const cifTok = cursor.consume()!;
        const cifParsed = parseCifCoords(cifTok.text);
        if (!cifParsed) continue;

        const cifLine = cifTok.line;

        // TEXT areas have no following keyword — handle specially
        if (cifParsed.kind === 'text') {
            const tsStart = cifTok.line;
            // scan to find end of text area
            let tsEnd = lines.length;
            for (let i = cursor.pos; i < cursor.tokens.length; i++) {
                const k2 = cursor.tokens[i].kind;
                if (k2 === TK.CifEndText || k2 === TK.CifCoord || isEndKeyword(k2)) {
                    tsEnd = cursor.tokens[i].line;
                    break;
                }
            }
            const textRaw = lines.slice(tsStart, tsEnd).join('\n').trim();
            const sym: SdlSymbol = {
                id: nextId(),
                kind: 'textArea',
                cif: cifParsed.coords,
                cifLine,
                cifRaw: cifTok.text,
                text: textRaw,
                textLineStart: tsStart,
                textLineEnd: tsEnd,
                children: [],
            };
            symbols.push(sym);
            skipToEndText(cursor);
            continue;
        }

        // Skip to the next structural token
        while (
            cursor.pos < cursor.tokens.length &&
            !isStructuralToken(cursor.peek()!.kind)
        ) {
            cursor.consume();
        }

        const kwTok = cursor.peek();
        if (!kwTok) break;

        // Handle `state aggregation` two-keyword combo
        let finalCifKind = cifParsed.kind;
        if (kwTok.kind === TK.KwState) {
            const after = cursor.at(1);
            if (after?.kind === TK.KwAggregation) finalCifKind = 'stateaggregation';
        }

        const symKind = cifKindToSymbolKind(finalCifKind, kwTok.kind);
        if (symKind === null) {
            // Unknown CIF kind – skip until next CIF or stop
            continue;
        }

        const kwIdx = cursor.pos;
        const [tsStart, tsEnd] = textSpan(cursor.tokens, kwIdx, lines);
        const textRaw = lines.slice(tsStart, tsEnd).join('\n').trim();

        const sym: SdlSymbol = {
            id: nextId(),
            kind: symKind,
            cif: cifParsed.coords,
            cifLine,
            cifRaw: cifTok.text,
            text: textRaw,
            textLineStart: tsStart,
            textLineEnd: tsEnd,
            children: [],
        };

        symbols.push(sym);
        recurse(symKind, cursor, lines, sym);
    }

    return symbols;
}

function isStructuralToken(k: TK): boolean {
    return k === TK.KwProcess || k === TK.KwSystem || k === TK.KwBlock ||
        k === TK.KwChannel || k === TK.KwSignalRoute ||
        k === TK.KwState || k === TK.KwAggregation || k === TK.KwSubstructure ||
        k === TK.KwInput || k === TK.KwProvided ||
        k === TK.KwStart || k === TK.KwTask || k === TK.KwOutput ||
        k === TK.KwNextstate || k === TK.KwDecision || k === TK.KwAlternative ||
        k === TK.KwProcedure || k === TK.KwCall || k === TK.KwReturn ||
        k === TK.KwJoin || k === TK.KwLabel || k === TK.KwConnect ||
        k === TK.KwComment || k === TK.KwText ||
        isEndKeyword(k);
}

// ── Per-symbol recursive parsing ────────────────────────────────────────────

function recurseSymbol(kind: SdlSymbolKind, cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    switch (kind) {
        case 'state':
        case 'stateAggregation':
            parseStateBody(cursor, lines, sym);
            break;
        case 'input':
        case 'continuousSignal':
            parseActionList(cursor, lines, sym, [TK.KwEndInput, TK.KwEndProvided]);
            break;
        case 'decision':
            parseDecisionBody(cursor, lines, sym);
            break;
        case 'alternative':
            parseAlternativeBody(cursor, lines, sym);
            break;
        case 'procedure':
            parseProcedureBody(cursor, lines, sym);
            break;
        case 'textArea':
            skipToEndText(cursor);
            break;
        default:
            // Terminal symbols (task, output, nextstate, etc.) — consume keyword, no children
            advancePastKeyword(cursor);
            break;
    }
}

function parseStateBody(cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    // Optional `state foo;` or `state aggregation foo;` — skip the keyword lines
    advancePastKeyword(cursor);

    // Check for SUBSTRUCTURE
    // Parse inputs / provided until ENDSTATE
    const inputKinds: TK[] = [TK.KwEndState];
    const children = parseSymbolList(cursor, lines, inputKinds, recurseSymbol);
    sym.children = children;

    // Handle substructure (nested state content)
    if (cursor.is(TK.KwEndState)) {
        cursor.consume(); // consume ENDSTATE
    }
}

function parseActionList(cursor: Cursor, lines: string[], sym: SdlSymbol, stopKinds: TK[]): void {
    advancePastKeyword(cursor);
    const children = parseSymbolList(cursor, lines, stopKinds, recurseSymbol);
    sym.children = children;
    if (cursor.is(...stopKinds)) cursor.consume();
}

function parseDecisionBody(cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    advancePastKeyword(cursor);
    // Collect ANSWER children
    const stopKinds: TK[] = [TK.KwEndDecision];
    const children = parseSymbolList(cursor, lines, stopKinds, recurseSymbol);
    sym.children = children;
    if (cursor.is(TK.KwEndDecision)) cursor.consume();
}

function parseAlternativeBody(cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    advancePastKeyword(cursor);
    const stopKinds: TK[] = [TK.KwEndAlternative];
    const children = parseSymbolList(cursor, lines, stopKinds, recurseSymbol);
    sym.children = children;
    if (cursor.is(TK.KwEndAlternative)) cursor.consume();
}

function parseProcedureBody(cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    advancePastKeyword(cursor);
    const stopKinds: TK[] = [TK.KwEndProcedure];
    const children = parseSymbolList(cursor, lines, stopKinds, recurseSymbol);
    sym.children = children;
    if (cursor.is(TK.KwEndProcedure)) cursor.consume();
}

function skipToEndText(cursor: Cursor): void {
    // TEXT area: advance until /* CIF ENDTEXT */ or ENDTEXT keyword
    while (cursor.pos < cursor.tokens.length) {
        const k = cursor.peek()!.kind;
        if (k === TK.CifEndText || k === TK.KwEndText) {
            cursor.consume();
            return;
        }
        if (k === TK.CifCoord) return; // next symbol starts
        cursor.consume();
    }
}

/** Advance the cursor past the current SDL keyword token (and optional semicolon). */
function advancePastKeyword(cursor: Cursor): void {
    if (cursor.pos < cursor.tokens.length && isStructuralToken(cursor.peek()!.kind)) {
        cursor.consume();
    }
}

// ── Top-level structure (SYSTEM / BLOCK / PROCESS) ─────────────────────────

/**
 * Skip nested SYSTEM/BLOCK/CHANNEL/SIGNALROUTE structure until we reach a
 * PROCESS keyword.  REQ-0750: these containers are parsed but ignored.
 */
function skipToProcess(cursor: Cursor): boolean {
    while (cursor.pos < cursor.tokens.length) {
        const k = cursor.peek()!.kind;
        if (k === TK.KwProcess) return true;
        cursor.consume();
    }
    return false;
}

function parseProcessContent(cursor: Cursor, lines: string[]): SdlSymbol[] {
    // Consume PROCESS keyword and optional name/semicolons
    advancePastKeyword(cursor);

    const stopKinds: TK[] = [TK.KwEndProcess];
    const children = parseSymbolList(cursor, lines, stopKinds, recurseSymbol);
    if (cursor.is(TK.KwEndProcess)) cursor.consume();
    return children;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse an SDL .pr source file and return an SdlModel.
 * Never throws; unrecognised content is silently skipped.
 */
export function parsePr(source: string): SdlModel {
    _idCounter = 0;
    const lines = source.split('\n');
    let tree: SdlSymbol[] = [];

    try {
        const tokens = tokenize(source);
        const cursor = new Cursor(tokens);

        if (skipToProcess(cursor)) {
            tree = parseProcessContent(cursor, lines);
        }
    } catch {
        // lenient – return whatever was collected so far
    }

    return { lines, tree };
}

// ── Utility: flatten symbol tree ───────────────────────────────────────────

export function flattenSymbols(symbols: SdlSymbol[]): SdlSymbol[] {
    const result: SdlSymbol[] = [];
    function walk(syms: SdlSymbol[]): void {
        for (const s of syms) {
            result.push(s);
            if (s.children.length > 0) walk(s.children);
        }
    }
    walk(symbols);
    return result;
}

/** Find a symbol by id anywhere in the tree. */
export function findSymbolById(symbols: SdlSymbol[], id: string): SdlSymbol | null {
    for (const s of symbols) {
        if (s.id === id) return s;
        const found = findSymbolById(s.children, id);
        if (found) return found;
    }
    return null;
}
