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
    CifEndLabel = 2,  // /* CIF End Label */
    CifKeep    = 3,   // /* CIF Keep ... */
    // Other comments (skip)
    BlockCmt   = 4,
    LineCmt    = 5,
    // String literals (kept to prevent keyword matches inside strings)
    StrLit     = 6,
    // END keywords (before their non-end base keywords)
    KwEndProcess      = 7,
    KwEndState        = 8,
    KwEndSubstructure = 9,
    KwEndInput        = 10,
    KwEndProvided     = 11,
    KwEndDecision     = 12,
    KwEndAlternative  = 13,
    KwEndProcedure    = 14,
    KwEndText         = 15,
    KwEndConnection   = 16,
    KwEndSystem       = 17,
    KwEndBlock        = 18,
    KwEndChannel      = 19,
    // Structural keywords
    KwProcess     = 20,
    KwSystem      = 21,
    KwBlock       = 22,
    KwChannel     = 23,
    KwSignalRoute = 24,
    KwState       = 25,
    KwAggregation = 26,
    KwSubstructure= 27,
    KwInput       = 28,
    KwProvided    = 29,
    KwStart       = 30,
    KwTask        = 31,
    KwOutput      = 32,
    KwNextstate   = 33,
    KwDecision    = 34,
    KwAlternative = 35,
    KwProcedure   = 36,
    KwCall        = 37,
    KwReturn      = 38,
    KwJoin        = 39,
    KwLabel       = 40,
    KwConnect     = 41,
    KwComment     = 42,
    KwText        = 43,
    // Punctuation
    Lparen    = 44,
    Rparen    = 45,
    Semicolon = 46,
    // Generic
    Ident    = 47,
    Number   = 48,
    Newline  = 49,
    Other    = 50,
}

/** buildLexer requires patterns anchored with ^ at the start of each attempt. */
const LEXER = buildLexer<TK>([
    // CIF annotations – must be before generic block-comment rule
    [true,  /^\/\*\s*CIF\s+ENDTEXT\s*\*\//gi,                                     TK.CifEndText],
    [true,  /^\/\*\s*CIF\s+End\s+Label\s*\*\//gi,                                 TK.CifEndLabel],
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
    [true, /^endconnection\b/gi,   TK.KwEndConnection],
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
            if (stopKinds.includes(k) || k === TK.CifCoord || k === TK.CifEndText || k === TK.CifEndLabel || k === TK.CifKeep) break;
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
const IGNORED_INLINE_CIF_LINE_RE = /^\s*\/\*\s*CIF\s+(?:Keep\b|End\s+Label\b).*\*\/\s*$/i;

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
        if (k === TK.CifCoord || k === TK.CifEndText || k === TK.CifEndLabel || k === TK.CifKeep) {
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
    TK.KwEndConnection,
    TK.KwEndSystem, TK.KwEndBlock, TK.KwEndChannel,
];

function isEndKeyword(k: TK): boolean {
    return END_KEYWORDS.includes(k);
}

function extractInlineText(lines: string[], startLine: number, endLine: number): string {
    return lines
        .slice(startLine, endLine)
        .filter(line => !IGNORED_INLINE_CIF_LINE_RE.test(line))
        .join('\n')
        .trim();
}

function stateSymbolKey(text: string): string | null {
    const match = /^\s*state(?:\s+aggregation)?\s+([^;\s]+)/i.exec(text.trim());
    return match ? match[1].toLowerCase() : null;
}

// ── Recursive descent ───────────────────────────────────────────────────────

/** Skip an entire SUBSTRUCTURE…ENDSUBSTRUCTURE block, handling nesting. */
function skipSubstructure(cursor: Cursor): void {
    cursor.consume(); // consume SUBSTRUCTURE keyword
    let depth = 1;
    while (cursor.pos < cursor.tokens.length && depth > 0) {
        const k = cursor.peek()!.kind;
        if (k === TK.KwSubstructure) depth++;
        else if (k === TK.KwEndSubstructure) depth--;
        cursor.consume();
    }
}

/**
 * Parse a list of CIF-annotated symbols until one of `stopKinds` is found
 * (or end of token stream).  Non-CIF content is skipped.
 * SUBSTRUCTURE blocks are skipped wholesale (inner CIF annotations belong
 * to the nested diagram, not the current level).
 * @param breakCifKinds  If set, stop BEFORE consuming a CIF annotation whose
 *   parsed kind is in this list (e.g. ['answer'] or 'answer' to stop before
 *   the next answer; ['input','provided','connect'] to stop before next handler).
 */
function parseSymbolList(
    cursor: Cursor,
    lines: string[],
    stopKinds: TK[],
    recurse: (kind: SdlSymbolKind, cursor: Cursor, lines: string[], sym: SdlSymbol) => void,
    breakCifKinds?: string | string[],
): SdlSymbol[] {
    const symbols: SdlSymbol[] = [];
    const pendingNestedByState = new Map<string, SdlSymbol[]>();

    while (cursor.pos < cursor.tokens.length) {
        if (cursor.is(...stopKinds)) break;

        const tok = cursor.peek()!;

        if (tok.kind === TK.CifEndText || tok.kind === TK.CifEndLabel || tok.kind === TK.CifKeep) {
            cursor.consume();
            continue;
        }

        if (tok.kind !== TK.CifCoord) {
            const nestedDeclaration = parseStandaloneStateSubstructure(cursor, lines);
            if (nestedDeclaration) {
                pendingNestedByState.set(nestedDeclaration.stateKey, nestedDeclaration.children);
                continue;
            }

            // Skip SUBSTRUCTURE blocks wholesale — inner CIF annotations belong
            // to the nested state diagram, not the current level.
            if (tok.kind === TK.KwSubstructure) {
                skipSubstructure(cursor);
            } else {
                cursor.consume();
            }
            continue;
        }

        // ── Stop before this CIF if its kind is in breakCifKinds ─────────
        if (breakCifKinds) {
            const peeked = parseCifCoords(tok.text);
            if (peeked) {
                const kinds = Array.isArray(breakCifKinds) ? breakCifKinds : [breakCifKinds];
                if (kinds.includes(peeked.kind)) break;
            }
        }

        // ── Found a CIF annotation ───────────────────────────────────────
        const cifTok = cursor.consume()!;
        const cifParsed = parseCifCoords(cifTok.text);
        if (!cifParsed) continue;

        const cifLine = cifTok.line;

        // TEXT areas have no following keyword — handle specially
        if (cifParsed.kind === 'text') {
            const tsStart = cifTok.line + 1;
            // scan to find end of text area
            let tsEnd = lines.length;
            for (let i = cursor.pos; i < cursor.tokens.length; i++) {
                const k2 = cursor.tokens[i].kind;
                if (k2 === TK.CifEndText || k2 === TK.CifCoord || isEndKeyword(k2)) {
                    tsEnd = cursor.tokens[i].line;
                    break;
                }
            }
            const textRaw = extractInlineText(lines, tsStart, tsEnd);
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
                nestedChildren: [],
            };
            symbols.push(sym);
            skipToEndText(cursor);
            continue;
        }

        if (cifParsed.kind === 'label') {
            const tsStart = cifTok.line + 1;
            let tsEnd = lines.length;
            for (let i = cursor.pos; i < cursor.tokens.length; i++) {
                const k2 = cursor.tokens[i].kind;
                if (k2 === TK.CifKeep) continue;
                if (k2 === TK.CifCoord || k2 === TK.CifEndLabel || isEndKeyword(k2)) {
                    tsEnd = cursor.tokens[i].line;
                    break;
                }
            }

            while (cursor.pos < cursor.tokens.length) {
                const k = cursor.peek()!.kind;
                if (k === TK.CifCoord || k === TK.CifEndLabel || isEndKeyword(k)) break;
                cursor.consume();
            }

            symbols.push({
                id: nextId(),
                kind: 'label',
                cif: cifParsed.coords,
                cifLine,
                cifRaw: cifTok.text,
                text: extractInlineText(lines, tsStart, tsEnd),
                textLineStart: tsStart,
                textLineEnd: tsEnd,
                children: [],
                nestedChildren: [],
            });
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
            nestedChildren: [],
        };

        symbols.push(sym);
        recurse(symKind, cursor, lines, sym);

        if ((sym.kind === 'state' || sym.kind === 'stateAggregation') && sym.nestedChildren.length === 0) {
            const key = stateSymbolKey(sym.text);
            const pendingNested = key ? pendingNestedByState.get(key) : undefined;
            if (key && pendingNested) {
                sym.nestedChildren = pendingNested;
                pendingNestedByState.delete(key);
            }
        }
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

/** CIF annotation kinds that represent state-level transition handlers. */
const STATE_HANDLER_CIF_KINDS = ['input', 'provided', 'connect'];

function parseSubstructureBody(cursor: Cursor, lines: string[]): SdlSymbol[] {
    cursor.consume();
    const children = parseSymbolList(cursor, lines, [TK.KwEndSubstructure], recurseSymbol);
    if (cursor.is(TK.KwEndSubstructure)) cursor.consume();
    return children;
}

function parseStandaloneStateSubstructure(
    cursor: Cursor,
    lines: string[],
): { stateKey: string; children: SdlSymbol[] } | null {
    if (!cursor.is(TK.KwState)) return null;

    const startPos = cursor.pos;
    cursor.consume();

    if (cursor.is(TK.KwAggregation)) {
        cursor.pos = startPos;
        return null;
    }

    let stateKey: string | null = null;
    while (cursor.pos < cursor.tokens.length) {
        const tok = cursor.peek();
        if (!tok) break;
        if (tok.kind === TK.CifCoord || isEndKeyword(tok.kind)) break;
        if (tok.kind === TK.Ident && stateKey === null) {
            stateKey = tok.text.toLowerCase();
        }
        if (tok.kind === TK.KwSubstructure) {
            const children = parseSubstructureBody(cursor, lines);
            if (!stateKey) {
                cursor.pos = startPos;
                return null;
            }
            return { stateKey, children };
        }
        if (isStructuralToken(tok.kind) && tok.kind !== TK.Semicolon) break;
        cursor.consume();
    }

    cursor.pos = startPos;
    return null;
}

function parseStateBody(cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    // Consume STATE keyword (leave AGGREGATION / name tokens for the loop below)
    advancePastKeyword(cursor);

    const handlers: SdlSymbol[] = [];
    let nestedChildren: SdlSymbol[] = [];

    while (cursor.pos < cursor.tokens.length) {
        if (cursor.is(TK.KwEndState)) break;

        const tok = cursor.peek()!;

        if (tok.kind === TK.CifEndText || tok.kind === TK.CifEndLabel || tok.kind === TK.CifKeep) {
            cursor.consume();
            continue;
        }

        if (tok.kind === TK.CifCoord) {
            const cifParsed = parseCifCoords(tok.text);
            if (!cifParsed || !STATE_HANDLER_CIF_KINDS.includes(cifParsed.kind)) {
                cursor.consume();   // non-handler CIF (comment anchor, text area, …)
                continue;
            }

            // ── State-level handler: INPUT, PROVIDED, or CONNECT ──────────
            const cifTok = cursor.consume()!;
            const cifLine = cifTok.line;

            // Skip any non-structural tokens between the CIF annotation and keyword
            while (cursor.pos < cursor.tokens.length && !isStructuralToken(cursor.peek()!.kind)) {
                cursor.consume();
            }
            const kwTok = cursor.peek();
            if (!kwTok || cursor.is(TK.KwEndState)) break;

            const symKind = cifKindToSymbolKind(cifParsed.kind, kwTok.kind);
            if (symKind === null) continue;

            const kwIdx = cursor.pos;
            const [tsStart, tsEnd] = textSpan(cursor.tokens, kwIdx, lines);
            const textRaw = lines.slice(tsStart, tsEnd).join('\n').trim();

            const handlerSym: SdlSymbol = {
                id: nextId(),
                kind: symKind,
                cif: cifParsed.coords,
                cifLine,
                cifRaw: cifTok.text,
                text: textRaw,
                textLineStart: tsStart,
                textLineEnd: tsEnd,
                children: [],
                nestedChildren: [],
            };
            handlers.push(handlerSym);

            // Consume handler keyword (INPUT, PROVIDED, or CONNECT)
            cursor.consume();

            // Parse the action sequence, stopping before the next handler CIF
            // annotation or ENDSTATE.  ENDINPUT/ENDPROVIDED are also honoured for
            // files that include explicit end-keywords.
            handlerSym.children = parseSymbolList(
                cursor, lines,
                [TK.KwEndState, TK.KwEndInput, TK.KwEndProvided],
                recurseSymbol,
                STATE_HANDLER_CIF_KINDS,
            );
            if (cursor.is(TK.KwEndInput, TK.KwEndProvided)) cursor.consume();
            continue;
        }

        // SUBSTRUCTURE defines the nested diagram owned by this state.
        if (tok.kind === TK.KwSubstructure) {
            nestedChildren = parseSubstructureBody(cursor, lines);
            if (sym.kind === 'stateAggregation') break;
        } else {
            cursor.consume();
        }
    }

    if (cursor.is(TK.KwEndState)) cursor.consume();
    sym.children = handlers;
    sym.nestedChildren = nestedChildren;
}

function parseActionList(cursor: Cursor, lines: string[], sym: SdlSymbol, stopKinds: TK[]): void {
    advancePastKeyword(cursor);
    const children = parseSymbolList(cursor, lines, stopKinds, recurseSymbol);
    sym.children = children;
    if (cursor.is(...stopKinds)) cursor.consume();
}

function parseDecisionBody(cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    advancePastKeyword(cursor);
    sym.children = parseAnswerList(cursor, lines, TK.KwEndDecision);
    if (cursor.is(TK.KwEndDecision)) cursor.consume();
}

function parseAlternativeBody(cursor: Cursor, lines: string[], sym: SdlSymbol): void {
    advancePastKeyword(cursor);
    sym.children = parseAnswerList(cursor, lines, TK.KwEndAlternative);
    if (cursor.is(TK.KwEndAlternative)) cursor.consume();
}

/**
 * Parse the body of a DECISION or ALTERNATIVE: a sequence of CIF ANSWER blocks.
 * Each answer gets:
 *   - text:     the raw label lines between the CIF ANSWER annotation and the
 *               first inner CIF annotation (e.g. "(TRUE):", "ELSE:")
 *   - children: the action sequence inside that answer, stopping before the
 *               next CIF ANSWER or the endKind keyword
 *
 * Non-ANSWER CIF annotations before the first answer (e.g. a COMMENT on the
 * decision condition) are skipped safely.
 */
function parseAnswerList(cursor: Cursor, lines: string[], endKind: TK): SdlSymbol[] {
    const answers: SdlSymbol[] = [];

    while (cursor.pos < cursor.tokens.length) {
        if (cursor.is(endKind)) break;

        const tok = cursor.peek()!;

        // Skip non-CIF tokens (identifiers, punctuation in condition text, keywords
        // like COMMENT that follow non-answer CIF annotations, etc.)
        if (tok.kind === TK.CifEndText || tok.kind === TK.CifEndLabel || tok.kind === TK.CifKeep) {
            cursor.consume();
            continue;
        }
        if (tok.kind !== TK.CifCoord) {
            cursor.consume();
            continue;
        }

        // Only handle CIF ANSWER annotations; skip anything else (e.g. CIF COMMENT
        // that annotates the decision condition).
        const cifParsed = parseCifCoords(tok.text);
        if (!cifParsed || cifParsed.kind !== 'answer') {
            cursor.consume(); // consume the CIF token; the following keyword / content
            continue;         // will be consumed by the non-CIF branch above
        }

        const cifTok = cursor.consume()!;
        const cifLine = cifTok.line;

        // Find where the first inner CIF annotation (or endKind) starts, so we can
        // extract the answer label text (e.g. "(TRUE):", "ELSE:") from the raw lines.
        let labelEndLine = lines.length;
        for (let i = cursor.pos; i < cursor.tokens.length; i++) {
            const k = cursor.tokens[i].kind;
            if (k === TK.CifCoord || k === TK.CifEndText || k === TK.CifEndLabel || k === TK.CifKeep || k === endKind) {
                labelEndLine = cursor.tokens[i].line;
                break;
            }
        }

        // Skip over the answer-label tokens in the token stream (e.g. `(TRUE):`)
        // without consuming any inner CIF annotations.
        while (cursor.pos < cursor.tokens.length) {
            const k = cursor.peek()!.kind;
            if (k === TK.CifCoord || k === endKind) break;
            if (isEndKeyword(k)) break;
            cursor.consume();
        }

        const answerLabel = lines.slice(cifLine + 1, labelEndLine).join('\n').trim();

        const sym: SdlSymbol = {
            id: nextId(),
            kind: 'answer',
            cif: cifParsed.coords,
            cifLine,
            cifRaw: cifTok.text,
            text: answerLabel,
            textLineStart: cifLine + 1,
            textLineEnd: labelEndLine,
            children: [],
            nestedChildren: [],
        };

        // Parse the action sequence inside this answer.  Stop before the next
        // CIF ANSWER annotation (breakCifKind) or when endKind is reached.
        sym.children = parseSymbolList(cursor, lines, [endKind], recurseSymbol, 'answer');

        answers.push(sym);
    }

    return answers;
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
        if (k === TK.CifEndLabel || k === TK.KwEndConnection) {
            cursor.consume();
            continue;
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
            if (s.nestedChildren.length > 0) walk(s.nestedChildren);
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
        const nestedFound = findSymbolById(s.nestedChildren, id);
        if (nestedFound) return nestedFound;
    }
    return null;
}
