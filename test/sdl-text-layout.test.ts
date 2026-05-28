import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSdlDisplayText, shouldLeftAlignSdlText } from '../webview/src/sdlTextLayout';

describe('SDL text layout', () => {
    it('strips the task keyword while preserving long task content', () => {
        const taskText = [
            'task payload := {',
            '  field_a 10,',
            '  field_b mkstring(chr(1))',
            '};',
        ].join('\n');

        assert.strictEqual(
            formatSdlDisplayText('task', taskText),
            ['payload := {', '  field_a 10,', '  field_b mkstring(chr(1))', '};'].join('\n'),
        );
    });

    it('removes CIF lines from text-area display text', () => {
        const raw = [
            '/* CIF TEXT (10, 20), (100, 80) */',
            'dcl alpha Integer;',
            '/* CIF Keep Specific Geode Partition \'default\' */',
            'dcl beta Boolean;',
        ].join('\n');

        assert.strictEqual(formatSdlDisplayText('textArea', raw), 'dcl alpha Integer;\ndcl beta Boolean;');
    });

    it('left aligns task and procedure-call text but keeps decisions centered', () => {
        assert.strictEqual(shouldLeftAlignSdlText('task'), true);
        assert.strictEqual(shouldLeftAlignSdlText('procedureCall'), true);
        assert.strictEqual(shouldLeftAlignSdlText('textArea'), true);
        assert.strictEqual(shouldLeftAlignSdlText('decision'), false);
        assert.strictEqual(shouldLeftAlignSdlText('nextstate'), false);
    });

    it('strips SDL keywords from representative symbol texts', () => {
        assert.strictEqual(formatSdlDisplayText('start', 'START;'), 'START');
        assert.strictEqual(formatSdlDisplayText('state', 'state Wait;'), 'Wait;');
        assert.strictEqual(formatSdlDisplayText('nextstate', 'NEXTSTATE Wait;'), 'Wait;');
        assert.strictEqual(formatSdlDisplayText('procedure', 'procedure route_event_reporting;'), 'route_event_reporting;');
        assert.strictEqual(formatSdlDisplayText('procedureCall', 'call route_housekeeping;'), 'route_housekeeping;');
        assert.strictEqual(formatSdlDisplayText('decision', 'decision present(flag);'), 'present(flag);');
        assert.strictEqual(formatSdlDisplayText('input', 'input Ping(data);'), 'Ping(data);');
        assert.strictEqual(formatSdlDisplayText('output', 'output Pong(data);'), 'Pong(data);');
        assert.strictEqual(formatSdlDisplayText('continuousSignal', 'provided charge > 5;'), 'charge > 5;');
        assert.strictEqual(formatSdlDisplayText('alternative', 'alternative c_true;'), 'c_true;');
        assert.strictEqual(formatSdlDisplayText('return', 'return done;'), 'done;');
        assert.strictEqual(formatSdlDisplayText('label', 'connection branch:'), 'branch:');
    });
});