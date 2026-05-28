import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSdlDisplayText, shouldLeftAlignSdlText } from '../webview/src/sdlTextLayout';

describe('SDL text layout', () => {
    it('preserves long task text instead of truncating it', () => {
        const taskText = [
            'task payload := {',
            '  field_a 10,',
            '  field_b mkstring(chr(1))',
            '};',
        ].join('\n');

        assert.strictEqual(formatSdlDisplayText('task', taskText), taskText);
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
});