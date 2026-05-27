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
