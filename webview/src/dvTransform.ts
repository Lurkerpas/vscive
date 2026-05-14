import type { Edge, Node } from '@xyflow/react';
import { DvConnectionModel, DvDeviceModel, DvModel, UiModel } from '../../src/model/types';

const SC_SCALE = 0.05;
export const DV_NODE_WIDTH = 320;
export const DV_NODE_HEIGHT = 220;
export const DV_DEVICE_WIDTH = 92;
export const DV_DEVICE_HEIGHT = 28;

function rectFromCoords(coords: number[] | undefined): { x1: number; y1: number; x2: number; y2: number } | null {
    if (!coords || coords.length < 4) {
        return null;
    }
    return { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] };
}

function findDeviceId(model: DvModel, nodeName: string, port: string): string | undefined {
    return model.nodes.find(node => node.name === nodeName)?.devices.find(device => (device.port || device.name) === port)?.id;
}

export function snapDeviceToEdge(x: number, y: number, parentWidth: number, parentHeight: number): { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom' } {
    const cx = x + DV_DEVICE_WIDTH / 2;
    const cy = y + DV_DEVICE_HEIGHT / 2;
    const distances = {
        left: Math.abs(cx),
        right: Math.abs(parentWidth - cx),
        top: Math.abs(cy),
        bottom: Math.abs(parentHeight - cy),
    };
    const edge = Object.entries(distances).sort((left, right) => left[1] - right[1])[0][0] as 'left' | 'right' | 'top' | 'bottom';
    const clampX = (value: number) => Math.max(0, Math.min(parentWidth - DV_DEVICE_WIDTH, value));
    const clampY = (value: number) => Math.max(0, Math.min(parentHeight - DV_DEVICE_HEIGHT, value));

    switch (edge) {
        case 'left':
            return { x: 0, y: clampY(y), edge };
        case 'right':
            return { x: parentWidth - DV_DEVICE_WIDTH, y: clampY(y), edge };
        case 'top':
            return { x: clampX(x), y: 0, edge };
        default:
            return { x: clampX(x), y: parentHeight - DV_DEVICE_HEIGHT, edge };
    }
}

export function buildDvGraph(dv: DvModel, ui: UiModel): { nodes: Node[]; edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    for (const node of dv.nodes) {
        const layout = rectFromCoords(ui.entities[node.id]?.coordinates);
        const x = layout ? layout.x1 * SC_SCALE : 80 + nodes.length * 360;
        const y = layout ? layout.y1 * SC_SCALE : 120;
        const width = layout ? Math.max((layout.x2 - layout.x1) * SC_SCALE, 180) : DV_NODE_WIDTH;
        const height = layout ? Math.max((layout.y2 - layout.y1) * SC_SCALE, 140) : DV_NODE_HEIGHT;

        nodes.push({
            id: node.id,
            type: 'dvNode',
            position: { x, y },
            data: {
                node,
                summary: node.partition.functions.slice(0, 4).map(fn => fn.name).join(', '),
                overflow: Math.max(node.partition.functions.length - 4, 0),
            },
            style: { width, height },
        });

        for (const [deviceIndex, device] of node.devices.entries()) {
            const deviceLayout = ui.entities[device.id]?.coordinates;
            let localX = width - DV_DEVICE_WIDTH;
            let localY = 36 + deviceIndex * 38;
            if (deviceLayout && deviceLayout.length >= 2) {
                localX = (deviceLayout[0] - (ui.entities[node.id]?.coordinates?.[0] ?? 0)) * SC_SCALE - DV_DEVICE_WIDTH / 2;
                localY = (deviceLayout[1] - (ui.entities[node.id]?.coordinates?.[1] ?? 0)) * SC_SCALE - DV_DEVICE_HEIGHT / 2;
            }
            const snapped = snapDeviceToEdge(localX, localY, width, height);
            nodes.push({
                id: device.id,
                type: 'dvDevice',
                parentId: node.id,
                extent: 'parent',
                position: { x: snapped.x, y: snapped.y },
                data: { device, edge: snapped.edge, nodeId: node.id },
                style: { width: DV_DEVICE_WIDTH, height: DV_DEVICE_HEIGHT },
            });
        }
    }

    for (const connection of dv.connections) {
        const sourceId = findDeviceId(dv, connection.fromNode, connection.fromPort);
        const targetId = findDeviceId(dv, connection.toNode, connection.toPort);
        if (!sourceId || !targetId) {
            continue;
        }
        edges.push({
            id: connection.id,
            source: sourceId,
            target: targetId,
            label: connection.name,
            type: 'smoothstep',
            data: { connection, messageCount: connection.messages.length },
        });
    }

    return { nodes, edges };
}

export function connectionEndpointsByDeviceId(model: DvModel, connection: DvConnectionModel): { sourceId?: string; targetId?: string } {
    return {
        sourceId: findDeviceId(model, connection.fromNode, connection.fromPort),
        targetId: findDeviceId(model, connection.toNode, connection.toPort),
    };
}

export function deviceById(model: DvModel, deviceId: string): { nodeId: string; nodeName: string; device: DvDeviceModel } | undefined {
    for (const node of model.nodes) {
        const device = node.devices.find(candidate => candidate.id === deviceId);
        if (device) {
            return { nodeId: node.id, nodeName: node.name, device };
        }
    }
    return undefined;
}