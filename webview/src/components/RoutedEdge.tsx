import React, { useState, useRef, useEffect } from 'react';
import { EdgeProps, BaseEdge, useReactFlow } from '@xyflow/react';
import { post } from '../vscodeApi';

interface Waypoint { x: number; y: number; }

function distPointToSegment(p: Waypoint, a: Waypoint, b: Waypoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) { return Math.hypot(p.x - a.x, p.y - a.y); }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function RoutedEdge({
    id, sourceX, sourceY, targetX, targetY,
    label, labelStyle, selected, data, style,
}: EdgeProps) {
    const { screenToFlowPosition } = useReactFlow();
    const initialWaypoints: Waypoint[] = (data as { waypoints?: Waypoint[] })?.waypoints ?? [];
    const [localWps, setLocalWps] = useState<Waypoint[]>(initialWaypoints);
    const draggingIdx = useRef<number | null>(null);

    // Sync waypoints when the model is reloaded externally (e.g. undo/redo)
    const wpKey = JSON.stringify(initialWaypoints);
    useEffect(() => {
        setLocalWps(JSON.parse(wpKey) as Waypoint[]);
    }, [wpKey]);

    // Build polyline path: source → waypoints → target
    const allPts = [{ x: sourceX, y: sourceY }, ...localWps, { x: targetX, y: targetY }];
    let pathD = `M ${allPts[0].x},${allPts[0].y}`;
    for (let i = 1; i < allPts.length; i++) {
        pathD += ` L ${allPts[i].x},${allPts[i].y}`;
    }

    // Label position: midpoint of the middle segment
    const midI = Math.max(1, Math.floor(allPts.length / 2));
    const labelX = (allPts[midI - 1].x + allPts[midI].x) / 2;
    const labelY = (allPts[midI - 1].y + allPts[midI].y) / 2;

    // ── Waypoint drag handlers ────────────────────────────────────────────
    const onHandlePointerDown = (e: React.PointerEvent, idx: number) => {
        e.preventDefault();
        e.stopPropagation();
        draggingIdx.current = idx;
        (e.target as Element).setPointerCapture(e.pointerId);
    };

    const onHandlePointerMove = (e: React.PointerEvent, idx: number) => {
        if (draggingIdx.current !== idx) { return; }
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        setLocalWps(wps => wps.map((wp, i) => i === idx ? pos : wp));
    };

    const onHandlePointerUp = (e: React.PointerEvent, idx: number) => {
        if (draggingIdx.current !== idx) { return; }
        draggingIdx.current = null;
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        setLocalWps(wps => {
            const next = wps.map((wp, i) => i === idx ? pos : wp);
            post({ type: 'updateConnectionWaypoints', id, waypoints: next });
            return next;
        });
    };

    const onHandleDblClick = (e: React.MouseEvent, idx: number) => {
        e.preventDefault();
        e.stopPropagation();
        setLocalWps(wps => {
            const next = wps.filter((_, i) => i !== idx);
            post({ type: 'updateConnectionWaypoints', id, waypoints: next });
            return next;
        });
    };

    // ── Shift+click on edge path adds a new waypoint ─────────────────────
    const onPathClick = (e: React.MouseEvent) => {
        if (!e.shiftKey) { return; }
        e.preventDefault();
        e.stopPropagation();
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const pts = [{ x: sourceX, y: sourceY }, ...localWps, { x: targetX, y: targetY }];
        let bestI = 0;
        let minD = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
            const d = distPointToSegment(pos, pts[i], pts[i + 1]);
            if (d < minD) { minD = d; bestI = i; }
        }
        const next = [...localWps.slice(0, bestI), pos, ...localWps.slice(bestI)];
        setLocalWps(next);
        post({ type: 'updateConnectionWaypoints', id, waypoints: next });
    };

    return (
        <>
            <BaseEdge
                id={id}
                path={pathD}
                labelX={labelX}
                labelY={labelY}
                label={label}
                labelStyle={labelStyle}
                style={{ ...style, stroke: selected ? '#89b4fa' : undefined }}
            />
            {/* Wider invisible interaction path — captures shift+click for waypoint insertion */}
            <path
                d={pathD}
                fill="none"
                strokeOpacity={0}
                strokeWidth={20}
                className="react-flow__edge-interaction"
                onClick={onPathClick}
                style={{ cursor: 'default' }}
            />
            {/* Draggable waypoint handles */}
            {localWps.map((wp, idx) => (
                <circle
                    key={idx}
                    cx={wp.x}
                    cy={wp.y}
                    r={5}
                    fill="#cba6f7"
                    stroke="#1e1e2e"
                    strokeWidth={1.5}
                    style={{ cursor: 'move' }}
                    onPointerDown={e => onHandlePointerDown(e, idx)}
                    onPointerMove={e => onHandlePointerMove(e, idx)}
                    onPointerUp={e => onHandlePointerUp(e, idx)}
                    onDoubleClick={e => onHandleDblClick(e, idx)}
                />
            ))}
        </>
    );
}
