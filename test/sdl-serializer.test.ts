import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS } from '../src/model/types';
import { parsePr, flattenSymbols } from '../src/parsers/SdlPrParser';
import { applySymbolMove, applySymbolTextEdit, applySymbolsDelete } from '../src/serializers/SdlPrSerializer';
import { buildSdlGraph } from '../webview/src/sdlTransform';

function findByKind(symbols: ReturnType<typeof flattenSymbols>, kind: string) {
    return symbols.find(symbol => symbol.kind === kind);
}

function hasEdge(edges: Array<{ source: string; target: string }>, source: string, target: string): boolean {
    return edges.some(edge => edge.source === source && edge.target === target);
}

describe('SDL serializer', () => {
    it('preserves indentation when saving moved symbol CIF comments', () => {
        const source = [
            'process Sample;',
            '    /* CIF TASK (10, 20), (120, 35) */',
            '    task old_value;',
            'endprocess Sample;',
        ].join('\n');

        const model = parsePr(source);
        const task = findByKind(flattenSymbols(model.tree), 'task');
        assert.ok(task);

        applySymbolMove(model, task, 40, 50, 120, 35);

        assert.strictEqual(model.lines[1], '    /* CIF TASK (40, 50), (120, 35) */');
    });

    it('preserves indentation when saving edited symbol text', () => {
        const source = [
            'process Sample;',
            '    /* CIF TASK (10, 20), (120, 35) */',
            '    task old_value;',
            'endprocess Sample;',
        ].join('\n');

        const model = parsePr(source);
        const task = findByKind(flattenSymbols(model.tree), 'task');
        assert.ok(task);

        applySymbolTextEdit(model, task, 'task updated_value;');

        assert.strictEqual(model.lines[2], '    task updated_value;');
    });

    it('updates subsequent symbol line references without double-shifting the edited symbol span', () => {
        const source = [
            'process Sample;',
            '    /* CIF TEXT (0, 0), (120, 60) */',
            '    dcl alpha Integer;',
            '    /* CIF ENDTEXT */',
            '    /* CIF TASK (0, 80), (120, 35) */',
            '    task setup;',
            'endprocess Sample;',
        ].join('\n');

        const model = parsePr(source);
        const flat = flattenSymbols(model.tree);
        const textArea = findByKind(flat, 'textArea');
        const task = findByKind(flat, 'task');
        assert.ok(textArea);
        assert.ok(task);

        applySymbolTextEdit(model, textArea, 'dcl alpha Integer;\ndcl beta Boolean;');

        assert.strictEqual(model.lines[2], '    dcl alpha Integer;');
        assert.strictEqual(model.lines[3], '    dcl beta Boolean;');
        assert.strictEqual(textArea.textLineStart, 2);
        assert.strictEqual(textArea.textLineEnd, 4);
        assert.strictEqual(task.cifLine, 5);
        assert.strictEqual(task.textLineStart, 6);
        assert.strictEqual(task.textLineEnd, 7);
    });

    it('deletes a middle transition symbol and rewires flow from predecessor to successor', () => {
        const source = [
            'process Flow;',
            '    /* CIF START (20, 10), (70, 35) */',
            '    START;',
            '    /* CIF TASK (20, 70), (120, 35) */',
            '    task A;',
            '    /* CIF OUTPUT (20, 130), (120, 35) */',
            '    output B;',
            '    /* CIF NEXTSTATE (20, 190), (90, 35) */',
            '    nextstate C;',
            'endprocess Flow;',
        ].join('\n');

        const model = parsePr(source);
        const flatBefore = flattenSymbols(model.tree);
        const taskA = findByKind(flatBefore, 'task');
        const outputB = findByKind(flatBefore, 'output');
        const nextstateC = findByKind(flatBefore, 'nextstate');
        assert.ok(taskA);
        assert.ok(outputB);
        assert.ok(nextstateC);

        applySymbolsDelete(model, [outputB.id]);

        const flatAfter = flattenSymbols(model.tree);
        assert.ok(!flatAfter.some(symbol => symbol.kind === 'output' && symbol.text.includes('output B;')));

        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);
        const taskAfter = findByKind(flatAfter, 'task');
        const nextstateAfter = findByKind(flatAfter, 'nextstate');
        assert.ok(taskAfter);
        assert.ok(nextstateAfter);
        assert.ok(hasEdge(graph.edges, taskAfter.id, nextstateAfter.id));
    });

    it('deletes the last child action in a procedure without removing endprocedure', () => {
        const source = [
            'process P;',
            '    /* CIF PROCEDURE (10, 10), (120, 35) */',
            '    procedure run;',
            '        /* CIF TASK (20, 60), (120, 35) */',
            '        task only_action;',
            '    endprocedure;',
            'endprocess P;',
        ].join('\n');

        const model = parsePr(source);
        const task = findByKind(flattenSymbols(model.tree), 'task');
        assert.ok(task);

        applySymbolsDelete(model, [task.id]);

        assert.ok(model.lines.some(line => /^\s*endprocedure\b/i.test(line)));
        const procedure = findByKind(model.tree, 'procedure');
        assert.ok(procedure);
        assert.strictEqual(procedure.children.length, 0);
    });
});