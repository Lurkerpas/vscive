import React from 'react';
import { NodeProps } from '@xyflow/react';
import { WAYPOINT_NODE_SIZE } from '../waypoints';

export function WaypointNode({ data, selected, dragging }: NodeProps) {
    const visibleSize = Math.max(Number((data as Record<string, unknown> | undefined)?.waypointSize ?? WAYPOINT_NODE_SIZE), 6);
    const borderWidth = Math.max(1, visibleSize * 0.1);
    const glowSize = Math.max(2, visibleSize * 0.2);
    return (
        <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: selected ? '#f9e2af' : '#cba6f7',
            border: `${borderWidth}px solid ${selected ? '#fab387' : '#1e1e2e'}`,
            boxSizing: 'border-box',
            boxShadow: selected || dragging ? `0 0 0 ${glowSize}px rgba(249, 226, 175, 0.28)` : 'none',
            cursor: 'move',
        }} />
    );
}
