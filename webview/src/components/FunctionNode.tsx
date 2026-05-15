import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { FunctionModel } from '../../../src/model/types';

interface FunctionNodeData {
    label: string;
    language: string;
    fn: FunctionModel;
    locked?: boolean;
    isConnSrc?: boolean;
    isConnTarget?: boolean;
    fontSizeFn?: number;
    fontScale?: number;
    functionColor?: string;
    functionFontColor?: string;
    functionBodyColor?: string;
    [key: string]: unknown;
}

export function FunctionNode({ data, selected }: NodeProps) {
    const d = data as FunctionNodeData;
    const caption = d.language ? `${d.label} [${d.language}]` : d.label;
    const functionColor = d.functionColor ?? '#313244';
    const functionFontColor = d.functionFontColor ?? '#cdd6f4';
    const functionBodyColor = d.functionBodyColor ?? '#1e1e2e';
    const borderColor = d.isConnSrc ? '#a6e3a1' : selected ? '#89b4fa' : functionColor;
    const fontScale = Math.max(d.fontScale ?? 1, 0.05);
    const headerPaddingY = Math.max(2, 6 * fontScale);
    const headerPaddingX = Math.max(4, 10 * fontScale);
    const headerRadius = Math.max(2, 4 * fontScale);
    const borderWidth = Math.max(1, 2 * fontScale);
    return (
        <div style={{
            width: '100%',
            height: '100%',
            border: `${borderWidth}px solid ${borderColor}`,
            borderRadius: 6,
            background: functionBodyColor,
            color: functionFontColor,
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
            <div style={{
                background: functionColor,
                padding: `${headerPaddingY}px ${headerPaddingX}px`,
                borderBottom: `1px solid ${borderColor}`,
                borderRadius: `${headerRadius}px ${headerRadius}px 0 0`,
                fontWeight: 700,
                fontSize: d.fontSizeFn ?? 90,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: 0.3 * fontScale,
                color: functionFontColor,
            }}>
                {caption}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }} />
            <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
            <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        </div>
    );
}
