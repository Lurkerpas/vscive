import React from 'react';
import { NodeProps } from '@xyflow/react';
import { WAYPOINT_NODE_SIZE } from '../waypoints';

export function WaypointNode({ selected, dragging }: NodeProps) {
    const visibleSize = WAYPOINT_NODE_SIZE;
    return (
        <div style={{
            width: visibleSize,
            height: visibleSize,
            borderRadius: '50%',
            background: selected ? '#f9e2af' : '#cba6f7',
            border: `2px solid ${selected ? '#fab387' : '#1e1e2e'}`,
            boxSizing: 'border-box',
            boxShadow: selected || dragging ? '0 0 0 4px rgba(249, 226, 175, 0.28)' : 'none',
            cursor: 'move',
        }} />
    );
}
