import { Node } from '@xyflow/react';

export const WAYPOINT_NODE_SIZE = 20;
export const WAYPOINT_NODE_RADIUS = WAYPOINT_NODE_SIZE / 2;

export function waypointNodeSize(scale = 1): number {
    return Math.max(WAYPOINT_NODE_SIZE * Math.max(scale, 0.05), 6);
}

export interface Waypoint {
    x: number;
    y: number;
}

export function makeWaypointNodeId(connectionId: string, index: number): string {
    return `${connectionId}::wp::${index}`;
}

export function parseWaypointNodeId(nodeId: string): { connectionId: string; index: number } | null {
    const match = /^(.*)::wp::(\d+)$/.exec(nodeId);
    if (!match) { return null; }
    return { connectionId: match[1], index: Number(match[2]) };
}

export function isWaypointNodeId(nodeId: string): boolean {
    return parseWaypointNodeId(nodeId) !== null;
}

export function waypointCenterFromNode(node: Node): Waypoint {
    const width = node.width ?? node.measured?.width ?? WAYPOINT_NODE_SIZE;
    const height = node.height ?? node.measured?.height ?? WAYPOINT_NODE_SIZE;
    return {
        x: node.position.x + width / 2,
        y: node.position.y + height / 2,
    };
}
