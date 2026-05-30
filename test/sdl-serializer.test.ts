import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS } from '../src/model/types';
import { parsePr, flattenSymbols } from '../src/parsers/SdlPrParser';
import { applySymbolInsert, applySymbolMove, applySymbolTextEdit, applySymbolsDelete } from '../src/serializers/SdlPrSerializer';
import { buildSdlGraph } from '../webview/src/sdlTransform';

function findByKind(symbols: ReturnType<typeof flattenSymbols>, kind: string) {
    return symbols.find(symbol => symbol.kind === kind);
}

function hasEdge(edges: Array<{ source: string; target: string }>, source: string, target: string): boolean {
    return edges.some(edge => edge.source === source && edge.target === target);
}

function findByText(symbols: ReturnType<typeof flattenSymbols>, text: string) {
    return symbols.find(symbol => symbol.text.includes(text));
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

    it('creates a new procedure from canvas context location and adds CIF coordinates', () => {
        const source = [
            'process AddCanvas;',
            '    /* CIF START (10, 10), (70, 35) */',
            '    START;',
            'endprocess AddCanvas;',
        ].join('\n');

        const model = parsePr(source);
        applySymbolInsert(model, {
            kind: 'procedure',
            mode: 'canvas',
            x: 140,
            y: 220,
            containerKind: 'tree',
        });

        const flat = flattenSymbols(model.tree);
        const procedure = findByText(flat, 'procedure new_procedure;');
        assert.ok(procedure);
        assert.ok(model.lines.some(line => /\/\*\s*CIF\s+PROCEDURE\s+\(140,\s*220\),\s*\(120,\s*35\)/i.test(line)));
        const procedureIndex = model.lines.findIndex(line => /\bprocedure\s+new_procedure;/i.test(line));
        const endprocessIndex = model.lines.findIndex(line => /^\s*endprocess\b/i.test(line));
        assert.ok(procedureIndex >= 0 && endprocessIndex >= 0 && procedureIndex < endprocessIndex);
    });

    it('sanitizes non-finite canvas coordinates so inserted symbols remain parseable', () => {
        const source = [
            'process SafeInsert;',
            'endprocess SafeInsert;',
        ].join('\n');

        const model = parsePr(source);
        applySymbolInsert(model, {
            kind: 'state',
            mode: 'canvas',
            x: Number.NaN,
            y: Number.POSITIVE_INFINITY,
            containerKind: 'tree',
        });

        const insertedState = findByText(flattenSymbols(model.tree), 'state new_state;');
        assert.ok(insertedState);
        assert.ok(model.lines.some(line => /\/\*\s*CIF\s+STATE\s+\(0,\s*0\),\s*\(100,\s*35\)/i.test(line)));
    });

    it('inserts canvas symbols inside PROCESS even when file has CHANNEL/BLOCK preamble', () => {
        const source = [
            'system demo;',
            'channel c',
            '    from env to titi with a;',
            'endchannel;',
            'block titi;',
            'process p;',
            '    /* CIF START (10, 10), (70, 35) */',
            '    START;',
            'endprocess p;',
            'endblock;',
            'endsystem;',
        ].join('\n');

        const model = parsePr(source);
        applySymbolInsert(model, {
            kind: 'state',
            mode: 'canvas',
            x: 962,
            y: 417,
            containerKind: 'tree',
        });

        const insertedState = findByText(flattenSymbols(model.tree), 'state new_state;');
        assert.ok(insertedState);

        const insertedStateIndex = model.lines.findIndex(line => /\bstate\s+new_state;/i.test(line));
        const endChannelIndex = model.lines.findIndex(line => /^\s*endchannel\b/i.test(line));
        const processIndex = model.lines.findIndex(line => /^\s*process\b/i.test(line));
        const endProcessIndex = model.lines.findIndex(line => /^\s*endprocess\b/i.test(line));

        assert.ok(insertedStateIndex > processIndex);
        assert.ok(insertedStateIndex < endProcessIndex);
        assert.ok(insertedStateIndex > endChannelIndex);
    });

    it('inserts a following symbol between connected neighbors', () => {
        const source = [
            'process InsertFlow;',
            '    /* CIF START (20, 10), (70, 35) */',
            '    START;',
            '    /* CIF OUTPUT (20, 120), (120, 35) */',
            '    output B;',
            'endprocess InsertFlow;',
        ].join('\n');

        const model = parsePr(source);
        const flatBefore = flattenSymbols(model.tree);
        const start = findByKind(flatBefore, 'start');
        assert.ok(start);

        applySymbolInsert(model, {
            kind: 'task',
            mode: 'following',
            anchorId: start.id,
            x: 20,
            y: 10,
        });

        const flatAfter = flattenSymbols(model.tree);
        const insertedTask = findByText(flatAfter, 'task action;');
        const output = findByKind(flatAfter, 'output');
        assert.ok(insertedTask);
        assert.ok(output);
        assert.strictEqual(output.cif?.y, 175);

        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);
        assert.ok(hasEdge(graph.edges, start.id, insertedTask.id));
        assert.ok(hasEdge(graph.edges, insertedTask.id, output.id));
        assert.ok(!hasEdge(graph.edges, start.id, output.id));
    });

    it('inserts input into state body and task into input body so both are connected', () => {
        const source = [
            'process NestedInsert;',
            '    /* CIF STATE (947, 254), (70, 35) */',
            '    state wait;',
            '    endstate;',
            'endprocess NestedInsert;',
        ].join('\n');

        const model = parsePr(source);

        applySymbolInsert(model, {
            kind: 'state',
            mode: 'canvas',
            x: 989,
            y: 436,
            containerKind: 'tree',
        });

        const insertedState = findByText(flattenSymbols(model.tree), 'state new_state;');
        assert.ok(insertedState);

        applySymbolInsert(model, {
            kind: 'input',
            mode: 'following',
            anchorId: insertedState.id,
            x: 987,
            y: 510,
        });

        const stateAfterInput = flattenSymbols(model.tree).find(symbol => symbol.id === insertedState.id);
        assert.ok(stateAfterInput);
        assert.strictEqual(stateAfterInput.children.length, 1);
        const insertedInput = stateAfterInput.children[0];
        assert.strictEqual(insertedInput.kind, 'input');

        applySymbolInsert(model, {
            kind: 'task',
            mode: 'following',
            anchorId: insertedInput.id,
            x: 987,
            y: 565,
        });

        const stateAfterTask = flattenSymbols(model.tree).find(symbol => symbol.id === insertedState.id);
        assert.ok(stateAfterTask);
        assert.strictEqual(stateAfterTask.children.length, 1);
        const inputAfterTask = stateAfterTask.children[0];
        assert.strictEqual(inputAfterTask.kind, 'input');
        assert.strictEqual(inputAfterTask.children.length, 1);
        const taskAfterTask = inputAfterTask.children[0];
        assert.strictEqual(taskAfterTask.kind, 'task');

        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);
        assert.ok(hasEdge(graph.edges, stateAfterTask.id, inputAfterTask.id));
        assert.ok(hasEdge(graph.edges, inputAfterTask.id, taskAfterTask.id));
        assert.ok(taskAfterTask.cif && inputAfterTask.cif && taskAfterTask.cif.y > inputAfterTask.cif.y);

        const inputLine = model.lines.findIndex(line => /^\s*input\s+signal_name;/i.test(line));
        const taskLine = model.lines.findIndex(line => /^\s*task\s+action;/i.test(line));
        const stateLine = model.lines.findIndex(line => /^\s*state\s+new_state;/i.test(line));
        const endStateLine = model.lines.findIndex((line, index) => index > stateLine && /^\s*endstate\b/i.test(line));
        assert.ok(inputLine > stateLine && inputLine < endStateLine);
        assert.ok(taskLine > inputLine && taskLine < endStateLine);
    });

    it('adds a decision alternative branch horizontally and reconnects to the post-decision symbol', () => {
        const source = [
            'process DecisionInsert;',
            '    /* CIF START (0, 0), (70, 35) */',
            '    START;',
            '    /* CIF DECISION (0, 60), (150, 50) */',
            '    decision cond;',
            '    /* CIF ANSWER (0, 130), (90, 23) */',
            '    (yes):',
            '    enddecision;',
            '    /* CIF NEXTSTATE (0, 200), (90, 35) */',
            '    nextstate done;',
            'endprocess DecisionInsert;',
        ].join('\n');

        const model = parsePr(source);
        const decision = findByKind(model.tree, 'decision');
        assert.ok(decision);

        applySymbolInsert(model, {
            kind: 'decisionAlternative',
            mode: 'following',
            anchorId: decision.id,
            x: 0,
            y: 0,
        });

        const decisionAfter = findByKind(model.tree, 'decision');
        assert.ok(decisionAfter);
        assert.strictEqual(decisionAfter.children.length, 2);

        const answers = decisionAfter.children.filter(child => child.kind === 'answer');
        assert.strictEqual(answers.length, 2);
        const newAnswer = answers.find(answer => answer.text.includes('(else):'));
        assert.ok(newAnswer);
        assert.ok(newAnswer.cif && answers[0].cif && newAnswer.cif.x > answers[0].cif.x);

        const nextstate = findByKind(model.tree, 'nextstate');
        assert.ok(nextstate);

        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);
        assert.ok(hasEdge(graph.edges, newAnswer.id, nextstate.id));
    });
});