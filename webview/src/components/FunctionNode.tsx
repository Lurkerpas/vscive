import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { FunctionModel } from '../../../src/model/types';

interface FunctionNodeData {
    label: string;
    language: string;
    fn: FunctionModel;
    [key: string]: unknown;
}

export function FunctionNode({ data, selected }: NodeProps) {
    const d = data as FunctionNodeData;
    return (
        <div style={{
            width: '100%',
            height: '100%',
            border: `2px solid ${selected ? '#0078d4' : '#555'}`,
            borderRadius: 4,
            background: '#1e1e2e',
            color: '#cdd6f4',
            fontFamily: 'monospace',
            fontSize: 11,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
        }}>
            {/* Header */}
            <div style={{
                background: '#313244',
                padding: '2px 6px',
                borderBottom: '1px solid #555',
                fontWeight: 'bold',
                fontSize: 12,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}>
                {d.label}
            </div>
            {/* Language badge */}
            <div style={{ padding: '2px 6px', color: '#a6adc8', fontSize: 10 }}>
                {d.language || '—'}
            </div>
            {/* React Flow connection handles (hidden, connections go through interface nodes) */}
            <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
            <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        </div>
    );
}
