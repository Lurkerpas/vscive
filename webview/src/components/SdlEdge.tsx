import React from 'react';
import { BaseEdge, EdgeProps, useReactFlow } from '@xyflow/react';
import { SdlEdgeData } from '../sdlTransform';

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function SdlEdge({
    id,
    source,
    sourceX,
    sourceY,
    target,
    targetX,
    targetY,
    data,
    markerEnd,
    style,
}: EdgeProps): React.ReactElement {
    const { getNode } = useReactFlow();
    const edgeData = (data as SdlEdgeData | undefined) ?? { kind: 'vertical' };

    let path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;

    if (edgeData.kind === 'rake') {
        const elbowY = Math.min(sourceY + 10, sourceY + Math.max((targetY - sourceY) / 2, 0));
        path = `M ${sourceX},${sourceY} L ${sourceX},${elbowY} L ${targetX},${elbowY} L ${targetX},${targetY}`;
    } else {
        const targetNode = getNode(target);
        const targetWidth = targetNode?.width ?? targetNode?.measured?.width ?? 0;
        const targetLeft = targetNode?.position.x ?? targetX - targetWidth / 2;
        const targetRight = targetLeft + targetWidth;
        const landingX = targetWidth > 0 ? clamp(sourceX, targetLeft, targetRight) : targetX;

        if (Math.abs(landingX - sourceX) < 0.5) {
            path = `M ${sourceX},${sourceY} L ${landingX},${targetY}`;
        } else {
            const elbowY = sourceY + Math.max((targetY - sourceY) / 2, 10);
            path = `M ${sourceX},${sourceY} L ${sourceX},${elbowY} L ${landingX},${elbowY} L ${landingX},${targetY}`;
        }
    }

    return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}