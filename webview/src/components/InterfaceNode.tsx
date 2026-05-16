import React from 'react';
import { NodeProps, Handle } from '@xyflow/react';
import { InterfaceModel } from '../../../src/model/types';
import { IfaceEdge, IFACE_W, IFACE_H, interfaceDimensions } from '../transform';
import { buildInterfaceHandleSpecs } from './interfaceHandles';

interface InterfaceNodeData {
    label: string;
    iface: InterfaceModel;
    edge?: IfaceEdge;
    fontSizeIface?: number;
    fontScale?: number;
    ifaceWidth?: number;
    ifaceHeight?: number;
    showInterfaceNames?: boolean;
    interfaceColor?: string;
    interfaceFontColor?: string;
    [key: string]: unknown;
}

const KIND_ICONS: Record<string, string> = {
    Cyclic:      '↻',
    Protected:   '🔒',
    Sporadic:    '⚡',
    Unprotected: '!',
};

const KIND_COLORS: Record<string, string> = {
    Cyclic:      '#a6e3a1',
    Sporadic:    '#89b4fa',
    Protected:   '#fab387',
    Unprotected: '#f38ba8',
};

const ICON = 22;

/**
 * Triangle points string given the tip direction.
 * 'right': base on left, tip on right  →  pointing inward for PI on left edge
 * 'left':  base on right, tip on left  →  pointing inward for PI on right edge
 * 'down':  base on top, tip on bottom
 * 'up':    base on bottom, tip on top
 */
function triPoints(dir: 'left' | 'right' | 'up' | 'down', width: number, height: number): string {
    switch (dir) {
        case 'right': return `0,0 0,${height} ${width},${height / 2}`;
        case 'left':  return `${width},0 ${width},${height} 0,${height / 2}`;
        case 'down':  return `0,0 ${width},0 ${width / 2},${height}`;
        case 'up':    return `0,${height} ${width},${height} ${width / 2},0`;
    }
}

export function InterfaceNode({ data, selected }: NodeProps) {
    const d = data as InterfaceNodeData;
    const { iface } = d;
    const edge: IfaceEdge = d.edge ?? 'left';
    const baseColor = d.interfaceColor ?? (KIND_COLORS[iface.kind] ?? '#cdd6f4');
    const color = selected ? '#89b4fa' : baseColor;
    const fontColor = d.interfaceFontColor ?? '#cdd6f4';
    const kindIcon = KIND_ICONS[iface.kind] ?? '?';
    const fontScale = Math.max(d.fontScale ?? 1, 0.05);
    const fallbackDimensions = interfaceDimensions(fontScale);
    const width = d.ifaceWidth ?? fallbackDimensions.width;
    const height = d.ifaceHeight ?? fallbackDimensions.height;
    const iconSize = Math.max(10, ICON * fontScale);

    // Tip direction:
    //   PI → tip toward function center (inward)
    //   RI → tip away from function center (outward)
    const tipDir = ((): 'left' | 'right' | 'up' | 'down' => {
        if (iface.type === 'provided') {
            return edge === 'left' ? 'right' : edge === 'right' ? 'left' : edge === 'top' ? 'down' : 'up';
        } else {
            return edge === 'left' ? 'left' : edge === 'right' ? 'right' : edge === 'top' ? 'up' : 'down';
        }
    })();

    // Single handle on the OUTSIDE of the triangle:
    //   PI: middle of the base edge (the flat outside side)
    //   RI: the tip vertex (pointing outward)
    // In both cases the outside is on the same side as the edge direction.
    const handleSpecs = buildInterfaceHandleSpecs(edge, color, width, height, fontScale);

    // Kind icon: place just outside the outer vertex/edge, slightly offset
    const iconStyle: React.CSSProperties = (() => {
        switch (edge) {
            case 'left':   return { position: 'absolute', left: -iconSize - 2, bottom: -iconSize - 2, fontSize: iconSize, color };
            case 'right':  return { position: 'absolute', right: -iconSize - 2, bottom: -iconSize - 2, fontSize: iconSize, color };
            case 'top':    return { position: 'absolute', top: -iconSize - 2, right: -iconSize - 2, fontSize: iconSize, color };
            case 'bottom': return { position: 'absolute', bottom: -iconSize - 2, right: -iconSize - 2, fontSize: iconSize, color };
        }
    })();

    // Label sits just inside the function border, next to the triangle.
    // The node container is positioned outside the function, so "inside" is
    // in the direction away from the edge.
    const FONT = d.fontSizeIface ?? 45;
    const GAP = Math.max(3, 8 * fontScale); // px between function border and label
    const labelStyle: React.CSSProperties = (() => {
        const base: React.CSSProperties = {
            position: 'absolute',
            whiteSpace: 'nowrap',
            fontSize: FONT,
            fontFamily: 'sans-serif',
            color: fontColor,
            pointerEvents: 'none',
            userSelect: 'none',
        };
        switch (edge) {
            // container at x = -IFACE_W; function border at node-local x=IFACE_W
            case 'left':   return { ...base, left: width + GAP, top: '50%', transform: 'translateY(-50%)' };
            // container at x = parentW;  function border at node-local x=0
            case 'right':  return { ...base, right: width + GAP, top: '50%', transform: 'translateY(-50%)' };
            // container at y = -IFACE_H; function border at node-local y=IFACE_H
            case 'top':    return { ...base, top: height + GAP, left: '50%', transform: 'translateX(-50%)' };
            // container at y = parentH;  function border at node-local y=0
            case 'bottom': return { ...base, bottom: height + GAP, left: '50%', transform: 'translateX(-50%)' };
        }
    })();

    return (
        <div
            style={{ position: 'relative', width, height, overflow: 'visible' }}
            title={`${iface.name} [${iface.type} / ${iface.kind}]`}
        >
            <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}>
                <polygon
                    points={triPoints(tipDir, width, height)}
                    fill={color}
                    fillOpacity={0.3}
                    stroke={color}
                    strokeWidth={Math.max(1, 2 * fontScale)}
                />
            </svg>
            {d.showInterfaceNames !== false && <span style={labelStyle}>{iface.name}</span>}
            <span style={iconStyle}>{kindIcon}</span>
            {handleSpecs.map(spec => (
                <Handle
                    key={spec.type}
                    type={spec.type}
                    position={spec.position}
                    style={spec.style}
                />
            ))}
        </div>
    );
}



