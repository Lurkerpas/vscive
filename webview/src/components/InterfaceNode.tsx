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

    return (
        <div
            title={`${iface.name} [${iface.type} / ${iface.kind}]`}
            style={{
                width: '100%',
                height: '100%',
                background: color,
                border: `2px solid ${selected ? '#0078d4' : '#333'}`,
                borderRadius: isProvided ? '50%' : 2,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                color: '#1e1e2e',
                fontWeight: 'bold',
                overflow: 'hidden',
                cursor: 'pointer',
            }}
        >
            {/* Source handle (for provided interfaces — they initiate connections) */}
            <Handle
                type="source"
                position={isProvided ? Position.Right : Position.Left}
                style={{ width: 6, height: 6, background: '#555' }}
            />
            <Handle
                type="target"
                position={isProvided ? Position.Left : Position.Right}
                style={{ width: 6, height: 6, background: '#555' }}
            />
            {iface.name.charAt(0).toUpperCase()}
        </div>
    );
}
