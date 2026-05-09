import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { FunctionModel } from '../../../src/model/types';

interface FunctionNodeData {
    label: string;
    language: string;
    fn: FunctionModel;
    locked?: boolean;
    [key: string]: unknown;
}

export function FunctionNode({ data, selected }: NodeProps) {
    const d = data as FunctionNodeData;
    const caption = d.language ? `${d.label} [${d.language}]` : d.label;
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
            <NodeResizer
                isVisible={!!selected && !d.locked}
                minWidth={200}
                minHeight={100}
                lineStyle={{ borderColor: '#89b4fa', borderWidth: 1 }}
                handleStyle={{ width: 10, height: 10, background: '#89b4fa', borderRadius: 2 }}
            />
            {/* Header */}
            <div style={{
                background: '#313244',
                padding: '6px 10px',
                borderBottom: '1px solid #6c7086',
                borderRadius: '4px 4px 0 0',
                fontWeight: 700,
                fontSize: 90,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: 0.3,
            }}>
                {caption}
            </div>
            {/* Body — reserved for nested functions */}
            <div style={{ flex: 1, overflow: 'hidden' }} />
            {/* Hidden handles — connections go through interface nodes */}
            <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
            <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        </div>
    );
}
