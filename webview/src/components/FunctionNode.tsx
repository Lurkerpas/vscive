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
            border: `2px solid ${selected ? '#89b4fa' : '#6c7086'}`,
            borderRadius: 6,
            background: '#1e1e2e',
            color: '#cdd6f4',
            fontFamily: 'sans-serif',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
        }}>
            {/* Header */}
            <div style={{
                background: '#313244',
                padding: '6px 10px',
                borderBottom: '1px solid #6c7086',
                borderRadius: '4px 4px 0 0',
                fontWeight: 700,
                fontSize: 15,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: 0.3,
            }}>
                {d.label}
            </div>
            {/* Language badge */}
            <div style={{ padding: '4px 10px', color: '#a6adc8', fontSize: 13 }}>
                {d.language || '—'}
            </div>
            {/* React Flow connection handles (hidden, connections go through interface nodes) */}
            <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
            <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        </div>
    );
}
