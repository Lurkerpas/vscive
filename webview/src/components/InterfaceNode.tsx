import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { InterfaceModel } from '../../../src/model/types';

interface InterfaceNodeData {
    label: string;
    iface: InterfaceModel;
    [key: string]: unknown;
}

const KIND_ICONS: Record<string, string> = {
    Cyclic: '↻',        // circle with arrow
    Protected: '🔒',   // lock
    Sporadic: '⚡',    // thunder
    Unprotected: '!',  // exclamation
};

const KIND_COLORS: Record<string, string> = {
    Cyclic: '#a6e3a1',
    Sporadic: '#89b4fa',
    Protected: '#fab387',
    Unprotected: '#f38ba8',
};

/**
 * Renders the interface as an SVG triangle.
 *
 * Provided (→ pointing toward function center, i.e. rightward):
 *   Triangle tip points RIGHT (into the function border).
 *   Handle on the LEFT edge (outside).
 *
 * Required (→ pointing away from function, i.e. leftward):
 *   Triangle tip points LEFT (away from function).
 *   Handle on the LEFT vertex (tip, outside).
 */
export function InterfaceNode({ data, selected }: NodeProps) {
    const d = data as InterfaceNodeData;
    const { iface } = d;
    const color = selected ? '#89b4fa' : (KIND_COLORS[iface.kind] ?? '#cdd6f4');
    const kindIcon = KIND_ICONS[iface.kind] ?? '?';

    // Triangle dimensions (in pixels)
    const W = 60;  // base width (horizontal extent)
    const H = 80;  // height (vertical extent)
    const ICON_SIZE = 26;

    if (iface.type === 'provided') {
        // Triangle: tip points RIGHT (into the function).
        // Points: left-top=(0,0), left-bottom=(0,H), tip-right=(W, H/2)
        // Connection handle at the LEFT midpoint (outside).
        return (
            <div style={{ position: 'relative', width: W, height: H, overflow: 'visible' }}
                title={`${iface.name} [${iface.type} / ${iface.kind}]`}>
                <svg width={W} height={H} style={{ overflow: 'visible' }}>
                    <polygon
                        points={`0,0 0,${H} ${W},${H / 2}`}
                        fill={color}
                        fillOpacity={0.25}
                        stroke={color}
                        strokeWidth={2}
                    />
                    {/* Kind icon — bottom-right of the base */}
                    <text
                        x={-ICON_SIZE * 0.5}
                        y={H + ICON_SIZE * 0.9}
                        fontSize={ICON_SIZE}
                        fill={color}
                        style={{ userSelect: 'none' }}
                    >{kindIcon}</text>
                    {/* Name label */}
                    <text
                        x={W / 2}
                        y={H / 2}
                        fontSize={20}
                        fill="#cdd6f4"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >{iface.name}</text>
                </svg>
                {/* Handle on LEFT edge (outside of function) */}
                <Handle
                    type="target"
                    position={Position.Left}
                    style={{ left: -4, top: H / 2, width: 12, height: 12, background: color, border: '2px solid #1e1e2e' }}
                />
            </div>
        );
    } else {
        // Required: tip points LEFT (away from function).
        // Points: right-top=(W,0), right-bottom=(W,H), tip-left=(0, H/2)
        // Connection handle on tip vertex LEFT (outside).
        return (
            <div style={{ position: 'relative', width: W, height: H, overflow: 'visible' }}
                title={`${iface.name} [${iface.type} / ${iface.kind}]`}>
                <svg width={W} height={H} style={{ overflow: 'visible' }}>
                    <polygon
                        points={`${W},0 ${W},${H} 0,${H / 2}`}
                        fill={color}
                        fillOpacity={0.25}
                        stroke={color}
                        strokeWidth={2}
                    />
                    {/* Kind icon — bottom-right of the base */}
                    <text
                        x={W + 2}
                        y={H + ICON_SIZE * 0.9}
                        fontSize={ICON_SIZE}
                        fill={color}
                        style={{ userSelect: 'none' }}
                    >{kindIcon}</text>
                    {/* Name label */}
                    <text
                        x={W / 2}
                        y={H / 2}
                        fontSize={20}
                        fill="#cdd6f4"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >{iface.name}</text>
                </svg>
                {/* Handle on LEFT vertex (tip = outside point) */}
                <Handle
                    type="source"
                    position={Position.Left}
                    style={{ left: -4, top: H / 2, width: 12, height: 12, background: color, border: '2px solid #1e1e2e' }}
                />
            </div>
        );
    }
}

