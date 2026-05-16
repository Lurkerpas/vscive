import type { Edge, Node } from '@xyflow/react';
import { FunctionModel, InterfaceModel } from '../../src/model/types';

export interface FocusVisibility {
    visibleFunctionIds: Set<string>;
    visibleInterfaceIds: Set<string>;
    visibleEdgeIds: Set<string>;
}

function isFunction(entity: FunctionModel | InterfaceModel | null): entity is FunctionModel {
    return entity !== null && !('kind' in entity);
}

function edgeConnectsInterface(edge: Edge, interfaceId: string): boolean {
    return edge.source === interfaceId || edge.target === interfaceId;
}

function isInterfaceNode(node: Node | undefined): node is Node & { data: { iface: InterfaceModel } } {
    return node?.type === 'interfaceNode' && typeof (node.data as { iface?: unknown } | undefined)?.iface === 'object';
}

export function computeFocusVisibility(
    focusEnabled: boolean,
    selected: FunctionModel | InterfaceModel | null,
    nodes: Node[],
    edges: Edge[],
): FocusVisibility | null {
    if (!focusEnabled || !selected) { return null; }

    const interfaceHost = new Map<string, string>();
    const functionInterfaces = new Map<string, Set<string>>();
    const functionParent = new Map<string, string | undefined>();
    const functionChildren = new Map<string, string[]>();
    const interfaceNodes = new Map<string, Node>();

    for (const node of nodes) {
        if (node.type === 'functionNode') {
            functionParent.set(node.id, node.parentId);
            if (node.parentId) {
                const bucket = functionChildren.get(node.parentId) ?? [];
                bucket.push(node.id);
                functionChildren.set(node.parentId, bucket);
            }
            continue;
        }

        if (node.type === 'interfaceNode' && node.parentId) {
            interfaceNodes.set(node.id, node);
            interfaceHost.set(node.id, node.parentId);
            const bucket = functionInterfaces.get(node.parentId) ?? new Set<string>();
            bucket.add(node.id);
            functionInterfaces.set(node.parentId, bucket);
        }
    }

    const visibleFunctionIds = new Set<string>();
    const visibleInterfaceIds = new Set<string>();
    const visibleEdgeIds = new Set<string>();

    const addFunctionWithAncestors = (functionId: string | undefined) => {
        let currentId = functionId;
        while (currentId) {
            if (visibleFunctionIds.has(currentId)) {
                currentId = functionParent.get(currentId);
                continue;
            }
            visibleFunctionIds.add(currentId);
            currentId = functionParent.get(currentId);
        }
    };

    const collectSubtreeFunctionIds = (functionId: string): Set<string> => {
        const subtreeIds = new Set<string>();
        const pending = [functionId];
        while (pending.length > 0) {
            const currentId = pending.pop()!;
            if (subtreeIds.has(currentId)) { continue; }
            subtreeIds.add(currentId);
            for (const childId of functionChildren.get(currentId) ?? []) {
                pending.push(childId);
            }
        }
        return subtreeIds;
    };

    const areFunctionsInProxyRelation = (leftId: string | undefined, rightId: string | undefined): boolean => {
        if (!leftId || !rightId || leftId === rightId) { return false; }

        let currentId: string | undefined = rightId;
        while (currentId) {
            if (currentId === leftId) { return true; }
            currentId = functionParent.get(currentId);
        }

        currentId = leftId;
        while (currentId) {
            if (currentId === rightId) { return true; }
            currentId = functionParent.get(currentId);
        }

        return false;
    };

    const isProxyEdge = (edge: Edge): boolean => {
        const sourceNode = interfaceNodes.get(edge.source);
        const targetNode = interfaceNodes.get(edge.target);
        if (!isInterfaceNode(sourceNode) || !isInterfaceNode(targetNode)) { return false; }
        const sourceHost = interfaceHost.get(edge.source);
        const targetHost = interfaceHost.get(edge.target);
        return sourceNode.data.iface.type === targetNode.data.iface.type
            && areFunctionsInProxyRelation(sourceHost, targetHost);
    };

    const addEdgeEndpoints = (edge: Edge) => {
        visibleEdgeIds.add(edge.id);
        visibleInterfaceIds.add(edge.source);
        visibleInterfaceIds.add(edge.target);
        addFunctionWithAncestors(interfaceHost.get(edge.source));
        addFunctionWithAncestors(interfaceHost.get(edge.target));
    };

    const expandVisibleProxyEdges = () => {
        let changed = true;
        while (changed) {
            changed = false;
            for (const edge of edges) {
                if (!isProxyEdge(edge)) { continue; }
                const touchesVisibleInterface = visibleInterfaceIds.has(edge.source) || visibleInterfaceIds.has(edge.target);
                if (!touchesVisibleInterface) { continue; }
                const beforeFunctions = visibleFunctionIds.size;
                const beforeInterfaces = visibleInterfaceIds.size;
                const beforeEdges = visibleEdgeIds.size;
                addEdgeEndpoints(edge);
                if (visibleFunctionIds.size !== beforeFunctions
                    || visibleInterfaceIds.size !== beforeInterfaces
                    || visibleEdgeIds.size !== beforeEdges) {
                    changed = true;
                }
            }
        }
    };

    if (isFunction(selected)) {
        addFunctionWithAncestors(selected.id);
        for (const ifaceId of functionInterfaces.get(selected.id) ?? new Set<string>()) {
            visibleInterfaceIds.add(ifaceId);
        }

        const selectedSubtreeIds = collectSubtreeFunctionIds(selected.id);
        for (const edge of edges) {
            const sourceHost = interfaceHost.get(edge.source);
            const targetHost = interfaceHost.get(edge.target);
            if (!sourceHost && !targetHost) { continue; }
            if (!selectedSubtreeIds.has(sourceHost ?? '') && !selectedSubtreeIds.has(targetHost ?? '')) { continue; }
            addEdgeEndpoints(edge);
        }
    } else {
        visibleInterfaceIds.add(selected.id);
        addFunctionWithAncestors(interfaceHost.get(selected.id));
        for (const edge of edges) {
            if (!edgeConnectsInterface(edge, selected.id)) { continue; }
            addEdgeEndpoints(edge);
        }
    }

    expandVisibleProxyEdges();

    return { visibleFunctionIds, visibleInterfaceIds, visibleEdgeIds };
}