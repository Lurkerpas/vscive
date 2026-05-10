import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { InterfaceModel } from '../../../src/model/types';
import { IfaceEdge, IFACE_W, IFACE_H } from '../transform';

interface InterfaceNodeData {
    label: string;
    iface: InterfaceModel;
    edge?: IfaceEdge;
    fontSizeIface?: number;
    showInterfaceNames?: boolean;
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

const W = IFACE_W;   // 60
const H = IFACE_H;  // 80
const ICON = 22;

/**
 * Triangle points string given the tip direction.
 * 'right': base on left, tip on right  →  pointing inward for PI on left edge
 * 'left':  base on right, tip on left  →  pointing inward for PI on right edge
 * 'down':  base on top, tip on bottom
 * 'up':    base on bottom, tip on top
 */
function triPoints(dir: 'left' | 'right' | 'up' | 'down'): string {
    switch (dir) {
        case 'right': return `0,0 0,${H} ${W},${H / 2}`;
        case 'left':  return `${W},0 ${W},${H} 0,${H / 2}`;
        case 'down':  return `0,0 ${W},0 ${W / 2},${H}`;
        case 'up':    return `0,${H} ${W},${H} ${W / 2},0`;
    }
}

export function InterfaceNode({ data, selected }: NodeProps) {
    const d = data as InterfaceNodeData;
    const { iface } = d;
    const edge: IfaceEdge = d.edge ?? 'left';
    const color = selected ? '#89b4fa' : (KIND_COLORS[iface.kind] ?? '#cdd6f4');
    const kindIcon = KIND_ICONS[iface.kind] ?? '?';

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
    const handlePos =
        edge === 'left'   ? Position.Left :
        edge === 'right'  ? Position.Right :
        edge === 'top'    ? Position.Top :
                            Position.Bottom;

    const handleStyle: React.CSSProperties = (() => {
        const base: React.CSSProperties = { width: 12, height: 12, background: color, border: '2px solid #1e1e2e' };
        switch (edge) {
            case 'left':   return { ...base, left: -4,   top:  H / 2 - 6 };
            case 'right':  return { ...base, right: -4,  top:  H / 2 - 6 };
            case 'top':    return { ...base, top:  -4,   left: W / 2 - 6 };
            case 'bottom': return { ...base, bottom: -4, left: W / 2 - 6 };
        }
    })();

    // Kind icon: place just outside the outer vertex/edge, slightly offset
    const iconStyle: React.CSSProperties = (() => {
        switch (edge) {
            case 'left':   return { position: 'absolute', left: -ICON - 2, bottom: -ICON - 2, fontSize: ICON, color };
            case 'right':  return { position: 'absolute', right: -ICON - 2, bottom: -ICON - 2, fontSize: ICON, color };
            case 'top':    return { position: 'absolute', top: -ICON - 2, right: -ICON - 2, fontSize: ICON, color };
            case 'bottom': return { position: 'absolute', bottom: -ICON - 2, right: -ICON - 2, fontSize: ICON, color };
        }
    })();

    // Label sits just inside the function border, next to the triangle.
    // The node container is positioned outside the function, so "inside" is
    // in the direction away from the edge.
    const FONT = d.fontSizeIface ?? 45;
    const GAP = 8; // px between function border and label
    const labelStyle: React.CSSProperties = (() => {
        const base: React.CSSProperties = {
            position: 'absolute',
            whiteSpace: 'nowrap',
            fontSize: FONT,
            fontFamily: 'sans-serif',
            color: '#cdd6f4',
            pointerEvents: 'none',
            userSelect: 'none',
        };
        switch (edge) {
            // container at x = -IFACE_W; function border at node-local x=IFACE_W
            case 'left':   return { ...base, left: IFACE_W + GAP, top: '50%', transform: 'translateY(-50%)' };
            // container at x = parentW;  function border at node-local x=0
            case 'right':  return { ...base, right: IFACE_W + GAP, top: '50%', transform: 'translateY(-50%)' };
            // container at y = -IFACE_H; function border at node-local y=IFACE_H
            case 'top':    return { ...base, top: IFACE_H + GAP, left: '50%', transform: 'translateX(-50%)' };
            // container at y = parentH;  function border at node-local y=0
            case 'bottom': return { ...base, bottom: IFACE_H + GAP, left: '50%', transform: 'translateX(-50%)' };
        }
    })();

    return (
        <div
            style={{ position: 'relative', width: W, height: H, overflow: 'visible' }}
            title={`${iface.name} [${iface.type} / ${iface.kind}]`}
        >
            <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
                <polygon
                    points={triPoints(tipDir)}
                    fill={color}
                    fillOpacity={0.3}
                    stroke={color}
                    strokeWidth={2}
                />
            </svg>
            {d.showInterfaceNames !== false && <span style={labelStyle}>{iface.name}</span>}
            <span style={iconStyle}>{kindIcon}</span>
            {iface.type === 'provided'
                ? <Handle type="target" position={handlePos} style={handleStyle} />
                : <Handle type="source" position={handlePos} style={handleStyle} />
            }
        </div>
    );
}



