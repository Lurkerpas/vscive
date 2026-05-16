import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Edge, Node } from '@xyflow/react';
import { FunctionModel, InterfaceModel } from '../src/model/types';
import { computeFocusEdges, computeFocusVisibility } from '../webview/src/focus';

function makeFunction(id: string, nestedFunctions: FunctionModel[] = []): FunctionModel {
    return {
        id,
        name: id,
        language: 'C',
        defaultImplementation: 'default',
        isType: false,
        fixedSystemElement: false,
        requiredSystemElement: false,
        providedInterfaces: [],
        requiredInterfaces: [],
        nestedFunctions,
        implementations: [{ name: 'default', language: 'C' }],
        properties: [],
        extraAttrs: {},
    };
}

function makeInterface(id: string): InterfaceModel {
    return {
        id,
        name: id,
        type: 'required',
        kind: 'Sporadic',
        parameters: [],
        inheritPI: false,
        autonamed: false,
        properties: [],
        extraAttrs: {},
    };
}

test('focus keeps proxy ancestors visible for connected nested targets', () => {
    const selected = makeFunction('left');
    const nodes = [
        { id: 'left', type: 'functionNode', position: { x: 0, y: 0 } },
        { id: 'proxy', type: 'functionNode', position: { x: 300, y: 0 } },
        { id: 'child', type: 'functionNode', position: { x: 40, y: 40 }, parentId: 'proxy' },
        { id: 'left-iface', type: 'interfaceNode', position: { x: 0, y: 0 }, parentId: 'left' },
        { id: 'child-iface', type: 'interfaceNode', position: { x: 0, y: 0 }, parentId: 'child' },
    ] as Node[];
    const edges = [{ id: 'conn', source: 'left-iface', target: 'child-iface' }] as Edge[];

    const visibility = computeFocusVisibility(true, selected, nodes, edges);

    assert.ok(visibility);
    assert.deepEqual([...visibility.visibleFunctionIds].sort(), ['child', 'left', 'proxy']);
    assert.deepEqual([...visibility.visibleInterfaceIds].sort(), ['child-iface', 'left-iface']);
    assert.deepEqual([...visibility.visibleEdgeIds], ['conn']);
});

test('focus treats a selected proxy function as connected through its children', () => {
    const child = makeFunction('child');
    const selected = makeFunction('proxy', [child]);
    const nodes = [
        { id: 'left', type: 'functionNode', position: { x: 0, y: 0 } },
        { id: 'proxy', type: 'functionNode', position: { x: 300, y: 0 } },
        { id: 'child', type: 'functionNode', position: { x: 40, y: 40 }, parentId: 'proxy' },
        { id: 'left-iface', type: 'interfaceNode', position: { x: 0, y: 0 }, parentId: 'left' },
        { id: 'child-iface', type: 'interfaceNode', position: { x: 0, y: 0 }, parentId: 'child' },
    ] as Node[];
    const edges = [{ id: 'conn', source: 'left-iface', target: 'child-iface' }] as Edge[];

    const visibility = computeFocusVisibility(true, selected, nodes, edges);

    assert.ok(visibility);
    assert.deepEqual([...visibility.visibleFunctionIds].sort(), ['child', 'left', 'proxy']);
    assert.deepEqual([...visibility.visibleInterfaceIds].sort(), ['child-iface', 'left-iface']);
    assert.deepEqual([...visibility.visibleEdgeIds], ['conn']);
});

test('focus keeps ancestor chain visible when selecting a nested interface', () => {
    const selected = makeInterface('child-iface');
    const nodes = [
        { id: 'left', type: 'functionNode', position: { x: 0, y: 0 } },
        { id: 'proxy', type: 'functionNode', position: { x: 300, y: 0 } },
        { id: 'child', type: 'functionNode', position: { x: 40, y: 40 }, parentId: 'proxy' },
        { id: 'left-iface', type: 'interfaceNode', position: { x: 0, y: 0 }, parentId: 'left' },
        { id: 'child-iface', type: 'interfaceNode', position: { x: 0, y: 0 }, parentId: 'child' },
    ] as Node[];
    const edges = [{ id: 'conn', source: 'left-iface', target: 'child-iface' }] as Edge[];

    const visibility = computeFocusVisibility(true, selected, nodes, edges);

    assert.ok(visibility);
    assert.deepEqual([...visibility.visibleFunctionIds].sort(), ['child', 'left', 'proxy']);
    assert.deepEqual([...visibility.visibleInterfaceIds].sort(), ['child-iface', 'left-iface']);
    assert.deepEqual([...visibility.visibleEdgeIds], ['conn']);
});

test('focus follows proxy edges from a direct target to the concrete nested target', () => {
    const selected = makeFunction('router');
    const nodes = [
        { id: 'router', type: 'functionNode', position: { x: 0, y: 0 } },
        { id: 'asw', type: 'functionNode', position: { x: 300, y: 0 } },
        { id: 'asw-packet-receiver', type: 'functionNode', position: { x: 40, y: 40 }, parentId: 'asw' },
        {
            id: 'router-ri',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'router',
            data: { iface: { ...makeInterface('router-ri'), type: 'required' } },
        },
        {
            id: 'asw-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'asw',
            data: { iface: { ...makeInterface('asw-pi'), type: 'provided' } },
        },
        {
            id: 'receiver-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'asw-packet-receiver',
            data: { iface: { ...makeInterface('receiver-pi'), type: 'provided' } },
        },
        {
            id: 'receiver-ri',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'asw-packet-receiver',
            data: { iface: { ...makeInterface('receiver-ri'), type: 'required' } },
        },
        {
            id: 'capability-router-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'capability-router',
            data: { iface: { ...makeInterface('capability-router-pi'), type: 'provided' } },
        },
        { id: 'capability-router', type: 'functionNode', position: { x: 500, y: 0 }, parentId: 'asw' },
    ] as Node[];
    const edges = [
        { id: 'router-to-asw', source: 'router-ri', target: 'asw-pi' },
        { id: 'asw-to-receiver', source: 'asw-pi', target: 'receiver-pi' },
        { id: 'receiver-to-capability-router', source: 'receiver-ri', target: 'capability-router-pi' },
    ] as Edge[];

    const visibility = computeFocusVisibility(true, selected, nodes, edges);

    assert.ok(visibility);
    assert.deepEqual([...visibility.visibleFunctionIds].sort(), ['asw', 'asw-packet-receiver', 'router']);
    assert.deepEqual([...visibility.visibleInterfaceIds].sort(), ['asw-pi', 'receiver-pi', 'router-ri']);
    assert.deepEqual([...visibility.visibleEdgeIds].sort(), ['asw-to-receiver', 'router-to-asw']);
});

test('focus renders the effective concrete edge instead of the intermediate proxy edge', () => {
    const selected = makeFunction('router');
    const nodes = [
        { id: 'router', type: 'functionNode', position: { x: 0, y: 0 } },
        { id: 'asw', type: 'functionNode', position: { x: 300, y: 0 } },
        { id: 'asw-packet-receiver', type: 'functionNode', position: { x: 40, y: 40 }, parentId: 'asw' },
        {
            id: 'router-ri',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'router',
            data: { iface: { ...makeInterface('router-ri'), type: 'required' } },
        },
        {
            id: 'routing-failed-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'asw',
            data: { iface: { ...makeInterface('routing-failed-pi'), type: 'provided' } },
        },
        {
            id: 'asw-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'asw',
            data: { iface: { ...makeInterface('asw-pi'), type: 'provided' } },
        },
        {
            id: 'receiver-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'asw-packet-receiver',
            data: { iface: { ...makeInterface('receiver-pi'), type: 'provided' } },
        },
    ] as Node[];
    const edges = [
        { id: 'router-to-asw', source: 'router-ri', target: 'asw-pi' },
        { id: 'router-to-routing-failed', source: 'router-ri', target: 'routing-failed-pi' },
        { id: 'asw-to-receiver', source: 'asw-pi', target: 'receiver-pi' },
    ] as Edge[];

    const visibility = computeFocusVisibility(true, selected, nodes, edges);
    const renderedEdges = computeFocusEdges(true, selected, nodes, edges, visibility);

    assert.ok(visibility);
    assert.deepEqual(
        renderedEdges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })).sort((left, right) => left.id.localeCompare(right.id)),
        [
            { id: 'router-to-asw::focus::router-ri::receiver-pi', source: 'router-ri', target: 'receiver-pi' },
            { id: 'router-to-routing-failed', source: 'router-ri', target: 'routing-failed-pi' },
        ],
    );
});

test('focus edge projection is disabled when focus is off', () => {
    const selected = makeFunction('router');
    const nodes = [
        { id: 'router', type: 'functionNode', position: { x: 0, y: 0 } },
        { id: 'asw', type: 'functionNode', position: { x: 300, y: 0 } },
        { id: 'child', type: 'functionNode', position: { x: 40, y: 40 }, parentId: 'asw' },
        {
            id: 'router-ri',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'router',
            data: { iface: { ...makeInterface('router-ri'), type: 'required' } },
        },
        {
            id: 'asw-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'asw',
            data: { iface: { ...makeInterface('asw-pi'), type: 'provided' } },
        },
        {
            id: 'child-pi',
            type: 'interfaceNode',
            position: { x: 0, y: 0 },
            parentId: 'child',
            data: { iface: { ...makeInterface('child-pi'), type: 'provided' } },
        },
    ] as Node[];
    const edges = [
        { id: 'router-to-asw', source: 'router-ri', target: 'asw-pi' },
        { id: 'asw-to-child', source: 'asw-pi', target: 'child-pi' },
    ] as Edge[];

    const renderedEdges = computeFocusEdges(false, selected, nodes, edges, null);

    assert.equal(renderedEdges, edges);
});