import React from 'react';
import { Position } from '@xyflow/react';
import { IfaceEdge } from '../transform';

export interface InterfaceHandleSpec {
    type: 'source' | 'target';
    position: Position;
    style: React.CSSProperties;
}

export function buildInterfaceHandleSpecs(
    edge: IfaceEdge,
    color: string,
    width: number,
    height: number,
    fontScale: number,
): InterfaceHandleSpec[] {
    const handleSize = Math.max(6, 12 * fontScale);
    const handleBorderWidth = Math.max(1, 2 * fontScale);
    const handleOffset = Math.max(2, 4 * fontScale);
    const position =
        edge === 'left'   ? Position.Left :
        edge === 'right'  ? Position.Right :
        edge === 'top'    ? Position.Top :
                            Position.Bottom;

    const base: React.CSSProperties = {
        width: handleSize,
        height: handleSize,
        background: color,
        border: `${handleBorderWidth}px solid #1e1e2e`,
    };
    const style: React.CSSProperties = (() => {
        switch (edge) {
            case 'left':   return { ...base, left: -handleOffset, top: height / 2 - handleSize / 2 };
            case 'right':  return { ...base, right: -handleOffset, top: height / 2 - handleSize / 2 };
            case 'top':    return { ...base, top: -handleOffset, left: width / 2 - handleSize / 2 };
            case 'bottom': return { ...base, bottom: -handleOffset, left: width / 2 - handleSize / 2 };
        }
    })();

    // Proxy links inside nested functions can be PI->PI or RI->RI, so each interface
    // must expose both endpoint roles at the same outer anchor.
    return [
        { type: 'source', position, style },
        { type: 'target', position, style },
    ];
}