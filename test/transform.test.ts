import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IvModel, UiModel } from '../src/model/types';
import { parseIvXml } from '../src/parsers/IvXmlParser';
import { parseUiXml } from '../src/parsers/UiXmlParser';
import { buildGraph } from '../webview/src/transform';
import { functionHeaderHeight } from '../webview/src/functionLayout';

test('buildGraph applies parsed UI coordinates for brace-wrapped IV ids', () => {
        const iv = parseIvXml(`<?xml version="1.0"?>
<InterfaceView version="1.0" UiFile="interfaceview.ui.xml">
    <Function id="{fn}" name="Function" is_type="NO" language="C" default_implementation="default" fixed_system_element="NO" required_system_element="NO">
        <Implementations>
            <Implementation name="default" language="C"/>
        </Implementations>
    </Function>
</InterfaceView>`);
        const ui = parseUiXml(`<?xml version="1.0"?>
<UI version="1.0">
    <Entity id="{fn}">
        <Taste coordinates="1000 2000 7000 8000"/>
    </Entity>
</UI>`);

        const { nodes } = buildGraph(iv, ui);
        const fnNode = nodes.find(node => node.id === '{fn}');

        assert.ok(fnNode);
        assert.equal(fnNode.position.x, 50);
        assert.equal(fnNode.position.y, 100);
        assert.equal(fnNode.style?.width, 300);
        assert.equal(fnNode.style?.height, 300);
});

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

test('buildGraph compresses nested functions into the parent content area below the header', () => {
    const iv: IvModel = {
        version: '1.0',
        asn1file: '',
        uiFile: '',
        modifierHash: '',
        functions: [{
            id: 'parent',
            name: 'Parent',
            language: 'C',
            defaultImplementation: 'default',
            isType: false,
            fixedSystemElement: false,
            requiredSystemElement: false,
            providedInterfaces: [],
            requiredInterfaces: [],
            nestedFunctions: [{
                id: 'child',
                name: 'Child',
                language: 'C',
                defaultImplementation: 'default',
                isType: false,
                fixedSystemElement: false,
                requiredSystemElement: false,
                providedInterfaces: [],
                requiredInterfaces: [],
                nestedFunctions: [],
                implementations: [{ name: 'default', language: 'C' }],
                properties: [],
                extraAttrs: {},
            }],
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
            parent: {
                coordinates: [0, 0, 10000, 10000],
                rootCoordinates: [0, 0, 10000, 10000],
            },
            child: {
                coordinates: [0, 0, 10000, 10000],
            },
        },
    };

    const { nodes } = buildGraph(iv, ui);
    const childNode = nodes.find(node => node.id === 'child');

    assert.ok(childNode);
    const headerHeight = functionHeaderHeight(1);
    assert.equal(childNode.parentId, 'parent');
    assert.equal(childNode.position.x, 0);
    assert.equal(childNode.position.y, headerHeight);
    assert.equal(childNode.style?.width, 500);
    assert.equal(childNode.style?.height, 500 - headerHeight);
});

test('buildGraph compresses connection waypoints into the parent content area below the header', () => {
    const iv: IvModel = {
        version: '1.0',
        asn1file: '',
        uiFile: '',
        modifierHash: '',
        functions: [{
            id: 'parent',
            name: 'Parent',
            language: 'C',
            defaultImplementation: 'default',
            isType: false,
            fixedSystemElement: false,
            requiredSystemElement: false,
            providedInterfaces: [],
            requiredInterfaces: [],
            nestedFunctions: [
                {
                    id: 'left-fn',
                    name: 'Left',
                    language: 'C',
                    defaultImplementation: 'default',
                    isType: false,
                    fixedSystemElement: false,
                    requiredSystemElement: false,
                    providedInterfaces: [{
                        id: 'left-pi',
                        name: 'LeftPI',
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
                },
                {
                    id: 'right-fn',
                    name: 'Right',
                    language: 'C',
                    defaultImplementation: 'default',
                    isType: false,
                    fixedSystemElement: false,
                    requiredSystemElement: false,
                    providedInterfaces: [],
                    requiredInterfaces: [{
                        id: 'right-ri',
                        name: 'RightRI',
                        type: 'required',
                        kind: 'Sporadic',
                        parameters: [],
                        inheritPI: false,
                        autonamed: false,
                        properties: [],
                        extraAttrs: {},
                    }],
                    nestedFunctions: [],
                    implementations: [{ name: 'default', language: 'C' }],
                    properties: [],
                    extraAttrs: {},
                },
            ],
            implementations: [{ name: 'default', language: 'C' }],
            properties: [],
            extraAttrs: {},
        }],
        connections: [{
            id: 'conn',
            name: 'Conn',
            sourceIfaceId: 'right-ri',
            sourceFuncName: 'Right',
            sourceRiName: 'RightRI',
            targetIfaceId: 'left-pi',
            targetFuncName: 'Left',
            targetPiName: 'LeftPI',
            properties: [],
            extraAttrs: {},
        }],
        comments: [],
        layers: [],
        unknownXmlAttrs: {},
    };

    const ui: UiModel = {
        version: '1.0',
        entities: {
            parent: {
                coordinates: [0, 0, 10000, 10000],
                rootCoordinates: [0, 0, 10000, 10000],
            },
            'left-fn': {
                coordinates: [0, 2000, 3000, 9000],
            },
            'right-fn': {
                coordinates: [7000, 2000, 10000, 9000],
            },
            'left-pi': {
                coordinates: [0, 4000],
            },
            'right-ri': {
                coordinates: [10000, 4000],
            },
            conn: {
                coordinates: [5000, 0],
            },
        },
    };

    const { nodes } = buildGraph(iv, ui);
    const waypointNode = nodes.find(node => node.id === 'conn::wp::0');

    assert.ok(waypointNode);
    const headerHeight = functionHeaderHeight(1);
    const waypointCenterY = waypointNode.position.y + ((waypointNode.width as number) / 2);
    assert.equal(waypointCenterY, headerHeight);
});