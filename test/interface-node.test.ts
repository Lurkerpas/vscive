import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Position } from '@xyflow/react';
import { buildInterfaceHandleSpecs } from '../webview/src/components/interfaceHandles';
import { InterfaceHandleSpec } from '../webview/src/components/interfaceHandles';

test('interface nodes expose both source and target handles at the same edge anchor', () => {
    const specs = buildInterfaceHandleSpecs('left', '#89b4fa', 60, 80, 1);

    assert.deepEqual(
        specs.map((spec: InterfaceHandleSpec) => ({ type: spec.type, position: spec.position })),
        [
            { type: 'source', position: Position.Left },
            { type: 'target', position: Position.Left },
        ],
    );
    assert.deepEqual(specs[0].style, specs[1].style);
});