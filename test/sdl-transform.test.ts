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

describe('SDL graph transform — decision flow', () => {
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
});