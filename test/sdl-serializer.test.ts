import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePr, flattenSymbols } from '../src/parsers/SdlPrParser';
import { applySymbolMove, applySymbolTextEdit } from '../src/serializers/SdlPrSerializer';

function findByKind(symbols: ReturnType<typeof flattenSymbols>, kind: string) {
    return symbols.find(symbol => symbol.kind === kind);
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
});