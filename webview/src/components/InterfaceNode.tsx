import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { InterfaceModel } from '../../../src/model/types';

interface InterfaceNodeData {
    label: string;
    iface: InterfaceModel;
    [key: string]: unknown;
}

const KIND_COLORS: Record<string, string> = {
    Cyclic: '#a6e3a1',
    Sporadic: '#89b4fa',
    Protected: '#fab387',
    Unprotected: '#f38ba8',
};

export function InterfaceNode({ data, selected }: NodeProps) {
    const d = data as InterfaceNodeData;
    const { iface } = d;
    const color = KIND_COLORS[iface.kind] ?? '#cdd6f4';
    const isProvided = iface.type === 'provided';
    const icon = isProvided ? '●' : '■';

    return (
        <div
            title={`${iface.name} [${iface.type} / ${iface.kind}]`}
            style={{
                width: '100%',
                height: '100%',
                background: '#181825',
                border: `2px solid ${selected ? '#89b4fa' : color}`,
                borderRadius: isProvided ? 20 : 4,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 8px',
                cursor: 'pointer',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
            }}
        >
            <Handle
                type="source"
                position={isProvided ? Position.Right : Position.Left}
                style={{ width: 8, height: 8, background: color, border: 'none' }}
            />
            <Handle
                type="target"
                position={isProvided ? Position.Left : Position.Right}
                style={{ width: 8, height: 8, background: color, border: 'none' }}
            />
            <span style={{ color, fontSize: 39, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
            <span style={{ color: '#cdd6f4', fontSize: 39, fontFamily: 'sans-serif', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {iface.name}
            </span>
        </div>
    );
}
