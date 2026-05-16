import type { Edge, Node } from '@xyflow/react';
import { FunctionModel, InterfaceModel } from '../../src/model/types';

export interface FocusVisibility {
    visibleFunctionIds: Set<string>;
    visibleInterfaceIds: Set<string>;
    visibleEdgeIds: Set<string>;
}

interface FocusGraphContext {
    interfaceHost: Map<string, string>;
    functionInterfaces: Map<string, Set<string>>;
    functionParent: Map<string, string | undefined>;
    functionChildren: Map<string, string[]>;
    interfaceNodes: Map<string, Node>;
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

function buildFocusGraphContext(nodes: Node[]): FocusGraphContext {
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

    return { interfaceHost, functionInterfaces, functionParent, functionChildren, interfaceNodes };
}

function areFunctionsInProxyRelation(ctx: FocusGraphContext, leftId: string | undefined, rightId: string | undefined): boolean {
    if (!leftId || !rightId || leftId === rightId) { return false; }

    let currentId: string | undefined = rightId;
    while (currentId) {
        if (currentId === leftId) { return true; }
        currentId = ctx.functionParent.get(currentId);
    }

    currentId = leftId;
    while (currentId) {
        if (currentId === rightId) { return true; }
        currentId = ctx.functionParent.get(currentId);
    }

    return false;
}

function isProxyEdge(ctx: FocusGraphContext, edge: Edge): boolean {
    const sourceNode = ctx.interfaceNodes.get(edge.source);
    const targetNode = ctx.interfaceNodes.get(edge.target);
    if (!isInterfaceNode(sourceNode) || !isInterfaceNode(targetNode)) { return false; }
    const sourceHost = ctx.interfaceHost.get(edge.source);
    const targetHost = ctx.interfaceHost.get(edge.target);
    return sourceNode.data.iface.type === targetNode.data.iface.type
        && areFunctionsInProxyRelation(ctx, sourceHost, targetHost);
}

function collectSubtreeFunctionIds(ctx: FocusGraphContext, functionId: string): Set<string> {
    const subtreeIds = new Set<string>();
    const pending = [functionId];
    while (pending.length > 0) {
        const currentId = pending.pop()!;
        if (subtreeIds.has(currentId)) { continue; }
        subtreeIds.add(currentId);
        for (const childId of ctx.functionChildren.get(currentId) ?? []) {
            pending.push(childId);
        }
    }
    return subtreeIds;
}

function collectProxyComponent(
    ctx: FocusGraphContext,
    edgeList: Edge[],
    startInterfaceId: string,
    visibleInterfaceIds?: Set<string>,
): Set<string> {
    const component = new Set<string>();
    const pending = [startInterfaceId];

    while (pending.length > 0) {
        const currentId = pending.pop()!;
        if (component.has(currentId)) { continue; }
        component.add(currentId);

        for (const edge of edgeList) {
            if (!isProxyEdge(ctx, edge)) { continue; }
            const touchesCurrent = edge.source === currentId || edge.target === currentId;
            if (!touchesCurrent) { continue; }
            const nextId = edge.source === currentId ? edge.target : edge.source;
            if (visibleInterfaceIds && !visibleInterfaceIds.has(nextId)) { continue; }
            pending.push(nextId);
        }
    }

    return component;
}

function projectProxyInterfaces(
    ctx: FocusGraphContext,
    edgeList: Edge[],
    startInterfaceId: string,
    selected: FunctionModel | InterfaceModel | null,
    visibleInterfaceIds?: Set<string>,
): string[] {
    const component = collectProxyComponent(ctx, edgeList, startInterfaceId, visibleInterfaceIds);
    if (component.size <= 1) { return [startInterfaceId]; }

    if (!isFunction(selected) && selected && component.has(selected.id)) {
        return [selected.id];
    }

    const leafIds = [...component].filter(candidateId => {
        const candidateHost = ctx.interfaceHost.get(candidateId);
        if (!candidateHost) { return true; }
        return ![...component].some(otherId => {
            if (otherId === candidateId) { return false; }
            const otherHost = ctx.interfaceHost.get(otherId);
            return areFunctionsInProxyRelation(ctx, candidateHost, otherHost)
                && candidateHost !== otherHost
                && otherHost !== undefined
                && (() => {
                    let currentId: string | undefined = otherHost;
                    while (currentId) {
                        if (currentId === candidateHost) { return true; }
                        currentId = ctx.functionParent.get(currentId);
                    }
                    return false;
                })();
        });
    });

    return leafIds.length > 0 ? leafIds : [startInterfaceId];
}

export function computeFocusVisibility(
    focusEnabled: boolean,
    selected: FunctionModel | InterfaceModel | null,
    nodes: Node[],
    edges: Edge[],
): FocusVisibility | null {
    if (!focusEnabled || !selected) { return null; }
    const ctx = buildFocusGraphContext(nodes);

    const visibleFunctionIds = new Set<string>();
    const visibleInterfaceIds = new Set<string>();
    const visibleEdgeIds = new Set<string>();

    const addFunctionWithAncestors = (functionId: string | undefined) => {
        let currentId = functionId;
        while (currentId) {
            if (visibleFunctionIds.has(currentId)) {
                currentId = ctx.functionParent.get(currentId);
                continue;
            }
            visibleFunctionIds.add(currentId);
            currentId = ctx.functionParent.get(currentId);
        }
    };

    const addEdgeEndpoints = (edge: Edge) => {
        visibleEdgeIds.add(edge.id);
        visibleInterfaceIds.add(edge.source);
        visibleInterfaceIds.add(edge.target);
        addFunctionWithAncestors(ctx.interfaceHost.get(edge.source));
        addFunctionWithAncestors(ctx.interfaceHost.get(edge.target));
    };

    const expandVisibleProxyEdges = () => {
        let changed = true;
        while (changed) {
            changed = false;
            for (const edge of edges) {
                if (!isProxyEdge(ctx, edge)) { continue; }
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
        for (const ifaceId of ctx.functionInterfaces.get(selected.id) ?? new Set<string>()) {
            visibleInterfaceIds.add(ifaceId);
        }

        const selectedSubtreeIds = collectSubtreeFunctionIds(ctx, selected.id);
        for (const edge of edges) {
            const sourceHost = ctx.interfaceHost.get(edge.source);
            const targetHost = ctx.interfaceHost.get(edge.target);
            if (!sourceHost && !targetHost) { continue; }
            if (!selectedSubtreeIds.has(sourceHost ?? '') && !selectedSubtreeIds.has(targetHost ?? '')) { continue; }
            addEdgeEndpoints(edge);
        }
    } else {
        visibleInterfaceIds.add(selected.id);
        addFunctionWithAncestors(ctx.interfaceHost.get(selected.id));
        for (const edge of edges) {
            if (!edgeConnectsInterface(edge, selected.id)) { continue; }
            addEdgeEndpoints(edge);
        }
    }

    expandVisibleProxyEdges();

    return { visibleFunctionIds, visibleInterfaceIds, visibleEdgeIds };
}

export function computeFocusEdges<T extends Edge>(
    focusEnabled: boolean,
    selected: FunctionModel | InterfaceModel | null,
    nodes: Node[],
    edges: T[],
    focusVisibility: FocusVisibility | null,
): T[] {
    if (!focusEnabled || !selected || !focusVisibility) { return edges; }

    const ctx = buildFocusGraphContext(nodes);
    const rendered = new Map<string, T>();

    for (const edge of edges) {
        if (!focusVisibility.visibleEdgeIds.has(edge.id)) { continue; }
        if (isProxyEdge(ctx, edge)) { continue; }

        const sourceIds = projectProxyInterfaces(ctx, edges, edge.source, selected, focusVisibility.visibleInterfaceIds);
        const targetIds = projectProxyInterfaces(ctx, edges, edge.target, selected, focusVisibility.visibleInterfaceIds);

        for (const sourceId of sourceIds) {
            for (const targetId of targetIds) {
                const sameEndpoints = sourceId === edge.source && targetId === edge.target;
                const nextId = sameEndpoints ? edge.id : `${edge.id}::focus::${sourceId}::${targetId}`;
                rendered.set(nextId, sameEndpoints ? edge : {
                    ...edge,
                    id: nextId,
                    source: sourceId,
                    target: targetId,
                });
            }
        }
    }

    return [...rendered.values()];
}