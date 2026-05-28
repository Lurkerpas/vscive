import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, SdlSymbol } from '../src/model/types';
import { parsePr } from '../src/parsers/SdlPrParser';
import { buildSdlGraph } from '../webview/src/sdlTransform';
import { readUtf8 } from './helpers';

function hasEdge(edges: { source: string; target: string }[], source: string, target: string): boolean {
    return edges.some(edge => edge.source === source && edge.target === target);
}

function findEdge(edges: Array<{ source: string; target: string; data?: { kind?: string } }>, source: string, target: string) {
    const edge = edges.find(candidate => candidate.source === source && candidate.target === target);
    assert.ok(edge, `Expected edge ${source} -> ${target}`);
    return edge;
}

function findByKind(symbols: SdlSymbol[], kind: SdlSymbol['kind']): SdlSymbol {
    const symbol = symbols.find(candidate => candidate.kind === kind);
    assert.ok(symbol, `Expected a ${kind} symbol`);
    return symbol;
}

function findByText(symbols: SdlSymbol[], text: string): SdlSymbol {
    const symbol = symbols.find(candidate => candidate.text.includes(text));
    assert.ok(symbol, `Expected a symbol containing text: ${text}`);
    return symbol;
}

function findNode(graph: ReturnType<typeof buildSdlGraph>, id: string) {
    const node = graph.nodes.find(candidate => candidate.id === id);
    assert.ok(node, `Expected node ${id}`);
    return node;
}

describe('SDL graph transform — decision flow', () => {
    it('maps rendered node positions and sizes directly from CIF coordinates', () => {
        const source = [
            'process Coordinates;',
            '    /* CIF PROCEDURE (15, 10), (90, 35) */',
            '    procedure route;',
            '        /* CIF START (40, 55), (70, 35) */',
            '        START;',
            '            /* CIF decision (20, 110), (150, 50) */',
            '            decision gate;',
            '                /* CIF ANSWER (35, 180), (90, 23) */',
            '                (path_a):',
            '                    /* CIF PROCEDURECALL (35, 225), (180, 35) */',
            '                    call do_a;',
            '                /* CIF ANSWER (220, 180), (90, 23) */',
            '                (path_b):',
            '                    /* CIF RETURN (248, 225), (35, 35) */',
            '                    return done;',
            '            enddecision;',
            '        /* CIF return (80, 290), (35, 35) */',
            '        return done;',
            '    endprocedure;',
            'endprocess Coordinates;',
        ].join('\n');

        const model = parsePr(source);
        const procedure = findByKind(model.tree, 'procedure');
        const graph = buildSdlGraph(procedure.children, 'procedure', DEFAULT_OPTIONS);

        const decision = findByKind(procedure.children, 'decision');
        const answerA = findByText(decision.children, '(path_a):');
        const answerB = findByText(decision.children, '(path_b):');
        const callA = findByKind(answerA.children, 'procedureCall');
        const returnB = findByKind(answerB.children, 'return');
        const finalReturn = findByText(procedure.children, 'return done;');

        for (const symbol of [decision, answerA, answerB, callA, returnB, finalReturn]) {
            const node = findNode(graph, symbol.id);
            assert.deepStrictEqual(node.position, { x: symbol.cif!.x, y: symbol.cif!.y });
            assert.strictEqual(node.width, symbol.cif!.w);
            assert.strictEqual(node.height, symbol.cif!.h);
        }
    });

    it('reconnects only non-breaking decision branches to the post-decision symbol', () => {
        const source = [
            'process Branching;',
            '    /* CIF START (0, 0), (70, 35) */',
            '    START;',
            '        /* CIF decision (0, 60), (120, 50) */',
            '        decision flag;',
            '            /* CIF ANSWER (0, 130), (100, 23) */',
            '            (yes):',
            '                /* CIF TASK (0, 170), (120, 35) */',
            '                task do_yes;',
            '            /* CIF ANSWER (220, 130), (100, 23) */',
            '            (no):',
            '                /* CIF return (220, 170), (35, 35) */',
            '                return;',
            '        enddecision;',
            '        /* CIF NEXTSTATE (0, 240), (70, 35) */',
            '        NEXTSTATE Done;',
            'endprocess Branching;',
        ].join('\n');

        const model = parsePr(source);
        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);

        const start = findByKind(model.tree, 'start');
        const decision = findByKind(model.tree, 'decision');
        const nextstate = findByKind(model.tree, 'nextstate');
        const yesAnswer = findByText(decision.children, '(yes):');
        const noAnswer = findByText(decision.children, '(no):');
        const yesTask = findByKind(yesAnswer.children, 'task');
        const noReturn = findByKind(noAnswer.children, 'return');

        assert.ok(hasEdge(graph.edges, start.id, decision.id));
        assert.ok(hasEdge(graph.edges, decision.id, yesAnswer.id));
        assert.ok(hasEdge(graph.edges, decision.id, noAnswer.id));
        assert.ok(hasEdge(graph.edges, yesAnswer.id, yesTask.id));
        assert.ok(hasEdge(graph.edges, yesTask.id, nextstate.id));
        assert.ok(hasEdge(graph.edges, noAnswer.id, noReturn.id));
        assert.ok(!hasEdge(graph.edges, decision.id, nextstate.id));
        assert.ok(!hasEdge(graph.edges, noReturn.id, nextstate.id));

        assert.strictEqual(findEdge(graph.edges, decision.id, yesAnswer.id).data?.kind, 'rake');
        assert.strictEqual(findEdge(graph.edges, yesAnswer.id, yesTask.id).data?.kind, 'vertical');
    });

    it('renders the martian lander event-reporting decision with branch-specific fallthrough', async () => {
        const src = await readUtf8('references/opus2/demo/ar/martian-lander/work/asw_capability_router/SDL/src/asw_capability_router.pr');
        const model = parsePr(src);

        const procedure = model.tree.find(symbol =>
            symbol.kind === 'procedure' && symbol.text.includes('route_event_reporting'),
        );
        assert.ok(procedure, 'Expected route_event_reporting procedure');

        const graph = buildSdlGraph(procedure.children, 'procedure', DEFAULT_OPTIONS);
        const decision = findByText(procedure.children, 'present(telecommand_data.telecommand.user_data_field.event_reporting)');
        const postDecisionReturn = findByKind(procedure.children, 'return');

        const enableAnswer = findByText(decision.children, 'enable_the_report_generation_of_event_definitions');
        const disableAnswer = findByText(decision.children, 'disable_the_report_generation_of_event_definitions');
        const reportAnswer = findByText(decision.children, 'report_the_list_of_disabled_event_definitions');

        const enableCall = findByKind(enableAnswer.children, 'procedureCall');
        const disableCall = findByKind(disableAnswer.children, 'procedureCall');
        const reportCall = findByKind(reportAnswer.children, 'procedureCall');

        assert.ok(hasEdge(graph.edges, decision.id, enableAnswer.id));
        assert.ok(hasEdge(graph.edges, decision.id, disableAnswer.id));
        assert.ok(hasEdge(graph.edges, decision.id, reportAnswer.id));
        assert.ok(hasEdge(graph.edges, enableAnswer.id, enableCall.id));
        assert.ok(hasEdge(graph.edges, disableAnswer.id, disableCall.id));
        assert.ok(hasEdge(graph.edges, reportAnswer.id, reportCall.id));
        assert.ok(hasEdge(graph.edges, enableCall.id, postDecisionReturn.id));
        assert.ok(hasEdge(graph.edges, disableCall.id, postDecisionReturn.id));
        assert.ok(hasEdge(graph.edges, reportCall.id, postDecisionReturn.id));
        assert.ok(!hasEdge(graph.edges, decision.id, postDecisionReturn.id));

        assert.strictEqual(findEdge(graph.edges, decision.id, enableAnswer.id).data?.kind, 'rake');
        assert.strictEqual(findEdge(graph.edges, enableAnswer.id, enableCall.id).data?.kind, 'vertical');
        assert.strictEqual(findEdge(graph.edges, enableCall.id, postDecisionReturn.id).data?.kind, 'vertical');
    });

    it('keeps floating-label connection blocks detached from the main transition while preserving their local flow', () => {
        const source = [
            'process Labels;',
            '    /* CIF START (0, 0), (70, 35) */',
            '    START;',
            '    /* CIF TASK (0, 50), (100, 35) */',
            '    task setup;',
            '    /* CIF LABEL (220, 0), (70, 35) */',
            '    connection branch:',
            '        /* CIF TASK (220, 50), (100, 35) */',
            '        task side_work;',
            '        /* CIF NEXTSTATE (220, 100), (90, 35) */',
            '        NEXTSTATE Done;',
            '    /* CIF End Label */',
            '    endconnection;',
            '    /* CIF NEXTSTATE (0, 110), (90, 35) */',
            '    NEXTSTATE Done;',
            'endprocess Labels;',
        ].join('\n');

        const model = parsePr(source);
        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);

        const start = findByKind(model.tree, 'start');
        const setup = findByText(model.tree, 'task setup;');
        const floatingLabel = findByText(model.tree, 'connection branch:');
        const sideWork = findByText(model.tree, 'task side_work;');
        const nextstates = model.tree.filter(symbol => symbol.kind === 'nextstate');
        assert.strictEqual(nextstates.length, 2);
        const branchNextstate = findNode(graph, nextstates[0].id).position.x === 220 ? nextstates[0] : nextstates[1];
        const mainNextstate = branchNextstate.id === nextstates[0].id ? nextstates[1] : nextstates[0];

        assert.ok(hasEdge(graph.edges, start.id, setup.id));
        assert.ok(hasEdge(graph.edges, floatingLabel.id, sideWork.id));
        assert.ok(hasEdge(graph.edges, sideWork.id, branchNextstate.id));
        assert.ok(hasEdge(graph.edges, setup.id, mainNextstate.id));
        assert.ok(!hasEdge(graph.edges, setup.id, floatingLabel.id));
        assert.ok(!hasEdge(graph.edges, branchNextstate.id, mainNextstate.id));
    });

    it('connects consecutive alternatives when the first one is empty', () => {
        const source = [
            'process Alternatives;',
            '    /* CIF START (0, 0), (70, 35) */',
            '    START;',
            '    /* CIF alternative (40, 60), (70, 50) */',
            '    alternative cond_a;',
            '    endalternative;',
            '    /* CIF alternative (40, 130), (70, 50) */',
            '    alternative cond_b;',
            '    /* CIF ANSWER (20, 200), (70, 23) */',
            '    else:',
            '        /* CIF PROCEDURECALL (10, 245), (130, 35) */',
            '        call notify_ok;',
            '    endalternative;',
            '    /* CIF NEXTSTATE (40, 300), (70, 35) */',
            '    NEXTSTATE done;',
            'endprocess Alternatives;',
        ].join('\n');

        const model = parsePr(source);
        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);

        const alternatives = model.tree.filter(symbol => symbol.kind === 'alternative');
        assert.strictEqual(alternatives.length, 2);
        const firstAlternative = alternatives[0];
        const secondAlternative = alternatives[1];
        const elseAnswer = findByText(secondAlternative.children, 'else:');
        const notifyCall = findByKind(elseAnswer.children, 'procedureCall');
        const nextstate = findByKind(model.tree, 'nextstate');

        assert.ok(hasEdge(graph.edges, firstAlternative.id, secondAlternative.id));
        assert.ok(hasEdge(graph.edges, secondAlternative.id, elseAnswer.id));
        assert.ok(hasEdge(graph.edges, elseAnswer.id, notifyCall.id));
        assert.ok(hasEdge(graph.edges, notifyCall.id, nextstate.id));
    });

    it('keeps text areas visible but out of execution flow', () => {
        const source = [
            'process Notes;',
            '    /* CIF START (0, 0), (70, 35) */',
            '    START;',
            '    /* CIF TEXT (0, 50), (120, 60) */',
            '    dcl charge Integer;',
            '    /* CIF ENDTEXT */',
            '    /* CIF TASK (0, 130), (120, 35) */',
            '    task setup;',
            '    /* CIF NEXTSTATE (0, 190), (90, 35) */',
            '    NEXTSTATE done;',
            'endprocess Notes;',
        ].join('\n');

        const model = parsePr(source);
        const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);

        const start = findByKind(model.tree, 'start');
        const textArea = findByKind(model.tree, 'textArea');
        const task = findByKind(model.tree, 'task');
        const nextstate = findByKind(model.tree, 'nextstate');

        assert.ok(findNode(graph, textArea.id));
        assert.ok(hasEdge(graph.edges, start.id, task.id));
        assert.ok(hasEdge(graph.edges, task.id, nextstate.id));
        assert.ok(!hasEdge(graph.edges, start.id, textArea.id));
        assert.ok(!hasEdge(graph.edges, textArea.id, task.id));
        assert.ok(!graph.edges.some(edge => edge.source === textArea.id || edge.target === textArea.id));
    });

    it('exposes nested state substructures as navigable diagrams without losing outer handlers', async () => {
        const src = await readUtf8('references/opengeode/tests/testsuite/test-battery/og.pr');
        const model = parsePr(src);

        const nominal = model.tree.find(symbol => symbol.kind === 'state' && symbol.text.includes('STATE nominal;'));
        assert.ok(nominal, 'Expected outer nominal state');
        const processGraph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);
        const nominalNode = findNode(processGraph, nominal.id);
        const backup = model.tree.find(symbol => symbol.kind === 'state' && symbol.text.includes('STATE backup;'));

        assert.strictEqual(nominalNode.data.hasChildren, true);
        assert.strictEqual(nominal.children.length, 1);
        assert.strictEqual(nominal.nestedChildren.some(symbol => symbol.kind === 'state' && symbol.text.includes('STATE battery;')), true);
        assert.ok(backup, 'Expected backup state');
        assert.ok(hasEdge(processGraph.edges, nominal.id, backup.id));

        const nominalNestedGraph = buildSdlGraph(nominal.nestedChildren, null, DEFAULT_OPTIONS);
        const nestedStart = findByKind(nominal.nestedChildren, 'start');
        const nestedNextstate = findByKind(nominal.nestedChildren, 'nextstate');
        const nestedBattery = nominal.nestedChildren.find(symbol => symbol.kind === 'state' && symbol.text.includes('STATE battery;'));
        assert.ok(nestedBattery, 'Expected nested battery state');
        const nestedConnect = nestedBattery.children.find(symbol => symbol.kind === 'connect');
        const nestedReturn = nestedConnect?.children.find(symbol => symbol.kind === 'return');

        assert.ok(hasEdge(nominalNestedGraph.edges, nestedStart.id, nestedNextstate.id));
        assert.ok(!hasEdge(nominalNestedGraph.edges, nestedNextstate.id, nestedBattery.id));
        assert.strictEqual(findNode(nominalNestedGraph, nestedBattery.id).data.hasChildren, true);
        assert.ok(nestedConnect, 'Expected connect battery_discharged');
        assert.ok(nestedReturn, 'Expected return battery_discharged');
    assert.ok(hasEdge(nominalNestedGraph.edges, nestedBattery.id, nestedReturn.id));
        assert.ok(hasEdge(nominalNestedGraph.edges, nestedReturn.id, nestedConnect.id));

        const batteryNestedGraph = buildSdlGraph(nestedBattery.nestedChildren, null, DEFAULT_OPTIONS);
        const discharge = nestedBattery.nestedChildren.find(symbol => symbol.kind === 'state' && symbol.text.includes('STATE discharge;'));
        assert.ok(discharge, 'Expected nested discharge state');
        const dischargeNode = findNode(batteryNestedGraph, discharge.id);

        assert.strictEqual(dischargeNode.data.hasChildren, false);
        assert.strictEqual(discharge.children.map(symbol => symbol.kind).join(','), 'input,continuousSignal,continuousSignal');
    });
});