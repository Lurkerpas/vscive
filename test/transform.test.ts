import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IvModel, UiModel } from '../src/model/types';
import { buildGraph } from '../webview/src/transform';

test('buildGraph uses external interface coordinates when both coordinate spaces exist', () => {
    const iv: IvModel = {
        version: '1.0',
        asn1file: '',
        uiFile: '',
        modifierHash: '',
        functions: [{
            id: 'fn',
            name: 'Function',
            language: 'C',
            defaultImplementation: 'default',
            isType: false,
            fixedSystemElement: false,
            requiredSystemElement: false,
            providedInterfaces: [{
                id: 'pi',
                name: 'PI',
                type: 'provided',
                kind: 'Sporadic',
                parameters: [],
                inheritPI: false,
                autonamed: false,
                properties: [],
                extraAttrs: {},
            }],
            requiredInterfaces: [],
            nestedFunctions: [],
            implementations: [{ name: 'default', language: 'C' }],
            properties: [],
            extraAttrs: {},
        }],
        connections: [],
        comments: [],
        layers: [],
        unknownXmlAttrs: {},
    };

    const ui: UiModel = {
        version: '1.0',
        entities: {
            fn: {
                coordinates: [10000, 20000, 15400, 23800],
                rootCoordinates: [5000, 15000, 19000, 27000],
            },
            pi: {
                coordinates: [10000, 21900],
                rootCoordinates: [16000, 25000],
            },
        },
    };

    const { nodes } = buildGraph(iv, ui);
    const ifaceNode = nodes.find(node => node.id === 'pi');

    assert.ok(ifaceNode);
    assert.equal(ifaceNode.position.x, -60);
    assert.equal(ifaceNode.position.y, 55);
    assert.equal((ifaceNode.data as { edge?: string }).edge, 'left');
});