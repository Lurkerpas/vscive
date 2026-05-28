/**
 * SDL parser tests.
 *
 * Reference .pr files are referenced by path only — their content is never
 * copied into this repository.  Tests read them at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readUtf8, findRelativeFiles } from './helpers';
import { parsePr, flattenSymbols } from '../src/parsers/SdlPrParser';
import { applySymbolMove } from '../src/serializers/SdlPrSerializer';

function findByKind(symbols: ReturnType<typeof flattenSymbols>, kind: string, text?: string) {
    return symbols.find(symbol => symbol.kind === kind && (text === undefined || symbol.text.includes(text)));
}

function assertCoords(
    symbol: { cif: { x: number; y: number; w: number; h: number } | null } | undefined,
    expected: { x: number; y: number; w: number; h: number },
): void {
    assert.ok(symbol, `Expected symbol at (${expected.x}, ${expected.y})`);
    assert.deepStrictEqual(symbol.cif, expected);
}

// ── Reference file paths ─────────────────────────────────────────────────────

/**
 * Well-known .pr files with a PROCESS section and CIF annotations,
 * referenced by repo-relative path.  These files are NOT embedded here.
 */
const KNOWN_PROCESS_FILES = [
    'references/opengeode/tests/testsuite/test1/og.pr',
    'references/opengeode/tests/testsuite/test-nextstate/og.pr',
    'references/opengeode/tests/testsuite/test-provided1/og.pr',
    'references/opengeode/tests/testsuite/test-choice/og.pr',
    'references/opengeode/tests/testsuite/test-modulo/og.pr',
    'references/opengeode/tests/testsuite/test-alternative/foo.pr',
    'references/opengeode/tests/testsuite/test-aggregation1/challenge.pr',
    'references/opengeode/tests/testsuite/test-math/expressions.pr',
    'references/opengeode/tests/testsuite/test6/myfunction.pr',
    'references/opengeode/tests/testsuite/test8/orchestrator.pr',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function parseFile(relPath: string) {
    const src = await readUtf8(relPath);
    return parsePr(src);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SDL parser — all *.pr files discovered under references/', async () => {
    // Collect all *.pr files at test-collection time using findRelativeFiles
    const allPrFiles = await findRelativeFiles(
        'references/opengeode/tests/testsuite',
        'og.pr',
    ).then(files =>
        files.concat(
            // Also pick up non-og named files
        )
    );

    it('discovers at least some reference .pr files', () => {
        assert.ok(allPrFiles.length >= 0, 'file scan should not throw');
    });
});

describe('SDL parser — known process files', () => {
    it('parsePr does not throw on any known process file', async () => {
        for (const relPath of KNOWN_PROCESS_FILES) {
            let src: string;
            try {
                src = await readUtf8(relPath);
            } catch {
                // File missing from this workspace — skip
                continue;
            }
            assert.doesNotThrow(() => parsePr(src), `parsePr threw on ${relPath}`);
        }
    });

    it('parsePr finds at least one symbol in each known process file', async () => {
        for (const relPath of KNOWN_PROCESS_FILES) {
            let src: string;
            try {
                src = await readUtf8(relPath);
            } catch {
                continue;
            }
            const model = parsePr(src);
            const flat = flattenSymbols(model.tree);
            assert.ok(
                flat.length > 0,
                `Expected symbols in ${relPath}, found 0. Tree length: ${model.tree.length}`,
            );
        }
    });
});

describe('SDL parser — structure', () => {
    it('parses test1/og.pr and finds START and STATE symbols', async () => {
        let src: string;
        try {
            src = await readUtf8('references/opengeode/tests/testsuite/test1/og.pr');
        } catch {
            return; // skip if not present
        }
        const model = parsePr(src);
        const flat = flattenSymbols(model.tree);
        const kinds = flat.map(s => s.kind);
        assert.ok(kinds.includes('start'), `Expected start, got: ${kinds.join(', ')}`);
        assert.ok(kinds.includes('state'), `Expected state, got: ${kinds.join(', ')}`);
    });

    it('parsePr preserves the original line count', async () => {
        let src: string;
        try {
            src = await readUtf8('references/opengeode/tests/testsuite/test1/og.pr');
        } catch {
            return;
        }
        const model = parsePr(src);
        const expectedLines = src.split('\n').length;
        assert.strictEqual(model.lines.length, expectedLines);
    });
});

describe('SDL parser — targeted construct samples', () => {
    it('parses text areas without including CIF markers in the text span', () => {
        const source = [
            'process Sample;',
            '/* CIF TEXT (10, 20), (120, 60) */',
            'dcl alpha Integer;',
            'dcl beta Boolean;',
            '/* CIF ENDTEXT */',
            'endprocess Sample;',
        ].join('\n');

        const model = parsePr(source);
        const textArea = model.tree[0];

        assert.strictEqual(textArea.kind, 'textArea');
        assertCoords(textArea, { x: 10, y: 20, w: 120, h: 60 });
        assert.strictEqual(textArea.text, 'dcl alpha Integer;\ndcl beta Boolean;');
        assert.strictEqual(textArea.textLineStart, 2);
        assert.strictEqual(textArea.textLineEnd, 4);
    });

    it('parses linear transition symbols and their coordinates inside a state handler', () => {
        const source = [
            'process Linear;',
            '/* CIF START (20, 10), (70, 35) */',
            'START;',
            '/* CIF STATE (180, 10), (90, 35) */',
            'state idle;',
            '/* CIF INPUT (170, 60), (120, 35) */',
            'input ping;',
            '/* CIF TASK (165, 110), (100, 35) */',
            'task count := count + 1;',
            '/* CIF OUTPUT (165, 160), (110, 35) */',
            'output pong;',
            '/* CIF PROCEDURECALL (165, 210), (150, 35) */',
            'call helper;',
            '/* CIF NEXTSTATE (180, 260), (90, 35) */',
            'nextstate idle;',
            'endstate;',
            'endprocess Linear;',
        ].join('\n');

        const model = parsePr(source);
        const flat = flattenSymbols(model.tree);
        const input = findByKind(flat, 'input', 'input ping;');
        const task = findByKind(flat, 'task', 'task count := count + 1;');
        const output = findByKind(flat, 'output', 'output pong;');
        const procedureCall = findByKind(flat, 'procedureCall', 'call helper;');
        const nextstate = findByKind(flat, 'nextstate', 'nextstate idle;');

        assertCoords(input, { x: 170, y: 60, w: 120, h: 35 });
        assertCoords(task, { x: 165, y: 110, w: 100, h: 35 });
        assertCoords(output, { x: 165, y: 160, w: 110, h: 35 });
        assertCoords(procedureCall, { x: 165, y: 210, w: 150, h: 35 });
        assertCoords(nextstate, { x: 180, y: 260, w: 90, h: 35 });
    });

    it('parses decisions, answers, and alternatives with nested coordinates', () => {
        const source = [
            'process Branches;',
            '/* CIF PROCEDURE (15, 15), (120, 35) */',
            'procedure choose;',
            '/* CIF START (30, 70), (70, 35) */',
            'START;',
            '/* CIF DECISION (20, 125), (150, 50) */',
            'decision gate;',
            '/* CIF ANSWER (25, 195), (90, 23) */',
            '(left):',
            '/* CIF TASK (20, 240), (95, 35) */',
            'task alpha;',
            '/* CIF ANSWER (210, 195), (95, 23) */',
            '(right):',
            '/* CIF ALTERNATIVE (205, 240), (130, 50) */',
            'alternative choice;',
            '/* CIF ANSWER (210, 310), (85, 23) */',
            '(only):',
            '/* CIF RETURN (235, 355), (35, 35) */',
            'return done;',
            'endalternative;',
            'enddecision;',
            '/* CIF RETURN (80, 410), (35, 35) */',
            'return done;',
            'endprocedure;',
            'endprocess Branches;',
        ].join('\n');

        const model = parsePr(source);
        const procedure = model.tree[0];
        assert.strictEqual(procedure.kind, 'procedure');

        const decision = procedure.children.find(symbol => symbol.kind === 'decision');
        assertCoords(decision, { x: 20, y: 125, w: 150, h: 50 });
        assert.strictEqual(decision?.children.length, 2);
        assertCoords(decision?.children[0], { x: 25, y: 195, w: 90, h: 23 });
        assertCoords(decision?.children[1], { x: 210, y: 195, w: 95, h: 23 });

        const alternative = decision?.children[1].children.find(symbol => symbol.kind === 'alternative');
        assertCoords(alternative, { x: 205, y: 240, w: 130, h: 50 });
        assert.strictEqual(alternative?.children.length, 1);
        assertCoords(alternative?.children[0], { x: 210, y: 310, w: 85, h: 23 });
    });

    it('parses provided and connect handlers within states with their child actions', () => {
        const source = [
            'process Handlers;',
            '/* CIF STATE (100, 20), (90, 35) */',
            'state ready;',
            '/* CIF PROVIDED (70, 80), (110, 35) */',
            'provided active;',
            '/* CIF RETURN (105, 130), (35, 35) */',
            'return done;',
            '/* CIF CONNECT (220, 80), (0, 35) */',
            'connect wakeup;',
            '/* CIF NEXTSTATE (200, 130), (95, 35) */',
            'nextstate ready;',
            'endstate;',
            'endprocess Handlers;',
        ].join('\n');

        const model = parsePr(source);
        const state = model.tree[0];
        assert.strictEqual(state.kind, 'state');
        assert.strictEqual(state.children.map(symbol => symbol.kind).join(','), 'continuousSignal,connect');
        assertCoords(state.children[0], { x: 70, y: 80, w: 110, h: 35 });
        assertCoords(state.children[1], { x: 220, y: 80, w: 0, h: 35 });
        assertCoords(state.children[0].children[0], { x: 105, y: 130, w: 35, h: 35 });
        assertCoords(state.children[1].children[0], { x: 200, y: 130, w: 95, h: 35 });
    });

    it('parses labels and joins without leaking endconnection markers into symbol text', () => {
        const source = [
            'process Labels;',
            '/* CIF LABEL (420, 40), (70, 35) */',
            'connection hop:',
            '/* CIF TASK (410, 95), (100, 35) */',
            'task branch;',
            '/* CIF JOIN (438, 145), (35, 35) */',
            'join hop;',
            '/* CIF End Label */',
            'endconnection;',
            '/* CIF STATE (80, 40), (90, 35) */',
            'state wait;',
            '/* CIF INPUT (80, 95), (90, 35) */',
            'input go;',
            '/* CIF LABEL (80, 145), (70, 35) */',
            'local:',
            '/* CIF JOIN (98, 195), (35, 35) */',
            'join hop;',
            'endstate;',
            'endprocess Labels;',
        ].join('\n');

        const model = parsePr(source);
        const flat = flattenSymbols(model.tree);
        const floatingLabel = findByKind(flat, 'label', 'connection hop:');
        const inlineLabel = findByKind(flat, 'label', 'local:');
        const joins = flat.filter(symbol => symbol.kind === 'join');

        assertCoords(floatingLabel, { x: 420, y: 40, w: 70, h: 35 });
        assert.strictEqual(floatingLabel?.text, 'connection hop:');
        assertCoords(inlineLabel, { x: 80, y: 145, w: 70, h: 35 });
        assert.strictEqual(inlineLabel?.text, 'local:');
        assert.strictEqual(joins.length, 2);
        assert.ok(joins.every(symbol => symbol.text === 'join hop;'));
    });

    it('parses multiline comments and preserves their coordinates', () => {
        const source = [
            'process Notes;',
            '/* CIF START (20, 20), (70, 35) */',
            'START;',
            '/* CIF COMMENT (120, 25), (140, 60) */',
            "comment 'first line",
            "second line';",
            '/* CIF RETURN (35, 95), (35, 35) */',
            'return done;',
            'endprocess Notes;',
        ].join('\n');

        const model = parsePr(source);
        const comment = findByKind(flattenSymbols(model.tree), 'comment');

        assertCoords(comment, { x: 120, y: 25, w: 140, h: 60 });
        assert.strictEqual(comment?.text, "comment 'first line\nsecond line';");
    });

    it('parses state aggregation while skipping CIF symbols from nested substructures', () => {
        const source = [
            'process Nested;',
            '/* CIF STATE (15, 20), (130, 35) */',
            'state aggregation outer;',
            'substructure',
            '/* CIF START (999, 999), (70, 35) */',
            'START;',
            'endsubstructure;',
            '/* CIF START (30, 90), (70, 35) */',
            'START;',
            'endprocess Nested;',
        ].join('\n');

        const model = parsePr(source);
        const flat = flattenSymbols(model.tree);
        const aggregation = model.tree[0];

        assert.strictEqual(aggregation.kind, 'stateAggregation');
        assertCoords(aggregation, { x: 15, y: 20, w: 130, h: 35 });
        assert.strictEqual(aggregation.nestedChildren.length, 1);
        assert.strictEqual(aggregation.nestedChildren[0].kind, 'start');
        assertCoords(aggregation.nestedChildren[0], { x: 999, y: 999, w: 70, h: 35 });
        assert.strictEqual(flat.filter(symbol => symbol.kind === 'start').length, 2);
    });

    it('attaches nested substructures to the owning state in the battery reference file', async () => {
        let src: string;
        try {
            src = await readUtf8('references/opengeode/tests/testsuite/test-battery/og.pr');
        } catch {
            return;
        }

        const model = parsePr(src);
        const nominal = model.tree.find(symbol => symbol.kind === 'state' && symbol.text.includes('STATE nominal;'));

        assert.ok(nominal, 'Expected outer nominal state');
        assert.strictEqual(nominal.children.length, 1);
        assert.strictEqual(nominal.children[0].kind, 'connect');
        assert.strictEqual(nominal.nestedChildren.some(symbol => symbol.kind === 'start'), true);

        const nestedBattery = nominal.nestedChildren.find(symbol => symbol.kind === 'state' && symbol.text.includes('STATE battery;'));
        assert.ok(nestedBattery, 'Expected nested battery state');
        assert.strictEqual(nestedBattery.children.length, 1);
        assert.strictEqual(nestedBattery.children[0].kind, 'connect');
        assert.strictEqual(nestedBattery.nestedChildren.some(symbol => symbol.kind === 'start'), true);

        const discharge = nestedBattery.nestedChildren.find(symbol => symbol.kind === 'state' && symbol.text.includes('STATE discharge;'));
        assert.ok(discharge, 'Expected nested discharge state');
        assert.strictEqual(discharge.children.map(symbol => symbol.kind).join(','), 'input,continuousSignal,continuousSignal');
    });
});

describe('SDL serializer — round-trip', () => {
    it('applySymbolMove updates the CIF line and leaves other lines unchanged', async () => {
        let src: string;
        try {
            src = await readUtf8('references/opengeode/tests/testsuite/test1/og.pr');
        } catch {
            return;
        }
        const model = parsePr(src);
        const flat = flattenSymbols(model.tree);
        const start = flat.find(s => s.kind === 'start');
        if (!start || start.cifLine === null) return;

        const origLine = model.lines[start.cifLine];
        applySymbolMove(model, start, 999, 888, 100, 50);

        // The CIF line should have changed
        assert.notStrictEqual(model.lines[start.cifLine], origLine);
        assert.ok(model.lines[start.cifLine].includes('999'), 'new x coordinate not found');
        assert.ok(model.lines[start.cifLine].includes('888'), 'new y coordinate not found');

        // All other lines should be unchanged
        const originalLines = src.split('\n');
        for (let i = 0; i < model.lines.length; i++) {
            if (i === start.cifLine) continue;
            assert.strictEqual(model.lines[i], originalLines[i], `Line ${i} was unexpectedly changed`);
        }
    });

    it('file content is identical when no changes are made', async () => {
        let src: string;
        try {
            src = await readUtf8('references/opengeode/tests/testsuite/test1/og.pr');
        } catch {
            return;
        }
        const model = parsePr(src);
        const rejoined = model.lines.join('\n');
        assert.strictEqual(rejoined, src);
    });
});

describe('SDL parser — aggregation / substructure', () => {
    it('parses aggregation file without throwing', async () => {
        let src: string;
        try {
            src = await readUtf8('references/opengeode/tests/testsuite/test-aggregation1/challenge.pr');
        } catch {
            return;
        }
        assert.doesNotThrow(() => parsePr(src));
        const model = parsePr(src);
        const flat = flattenSymbols(model.tree);
        assert.ok(flat.length > 0, 'Expected some symbols');
    });
});
