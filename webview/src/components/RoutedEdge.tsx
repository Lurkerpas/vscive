import React, { useState, useRef, useEffect } from 'react';
import { EdgeProps, BaseEdge, useReactFlow } from '@xyflow/react';
import { post } from '../vscodeApi';
import { useEdgeMenu } from './EdgeMenuContext';

interface Waypoint { x: number; y: number; }

function distPointToSegment(p: Waypoint, a: Waypoint, b: Waypoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) { return Math.hypot(p.x - a.x, p.y - a.y); }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Find the waypoint insertion index and the exact click position, given all polyline points. */
function nearestSegmentInsertion(
    pos: Waypoint,
    pts: Waypoint[],
    localWps: Waypoint[],
): { wps: Waypoint[]; insertIdx: number } {
    let bestI = 0;
    let minD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const d = distPointToSegment(pos, pts[i], pts[i + 1]);
        if (d < minD) { minD = d; bestI = i; }
    }
    // bestI is index into pts (which starts with source), so local waypoint insert index = bestI
    const wps = [...localWps.slice(0, bestI), pos, ...localWps.slice(bestI)];
    return { wps, insertIdx: bestI };
}

export function RoutedEdge({
    id, sourceX, sourceY, targetX, targetY,
    label, labelStyle, selected, data, style,
}: EdgeProps) {
    const { screenToFlowPosition } = useReactFlow();
    const { showContextMenu } = useEdgeMenu();
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
        if (e.button !== 0) { return; } // only primary button
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

    // ── Waypoint right-click → "Remove Node" / "Remove Connection" ───────
    const onCircleContextMenu = (e: React.MouseEvent, idx: number) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
            {
                label: 'Remove Node',
                onClick: () => {
                    setLocalWps(wps => {
                        const next = wps.filter((_, i) => i !== idx);
                        post({ type: 'updateConnectionWaypoints', id, waypoints: next });
                        return next;
                    });
                },
            },
            {
                label: 'Remove Connection',
                danger: true,
                onClick: () => post({ type: 'delete', ids: [id] }),
            },
        ]);
    };

    // ── Edge path right-click → "Add Node" / "Remove Connection" ─────────
    const onPathContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        // Compute nearest-segment insertion eagerly so the position is captured at right-click time
        const { wps: insertedWps } = nearestSegmentInsertion(pos, allPts, localWps);
        showContextMenu(e.clientX, e.clientY, [
            {
                label: 'Add Node',
                onClick: () => {
                    setLocalWps(insertedWps);
                    post({ type: 'updateConnectionWaypoints', id, waypoints: insertedWps });
                },
            },
            {
                label: 'Remove Connection',
                danger: true,
                onClick: () => post({ type: 'delete', ids: [id] }),
            },
        ]);
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
            {/* Wider invisible interaction path — right-click for context menu */}
            <path
                d={pathD}
                fill="none"
                strokeOpacity={0}
                strokeWidth={20}
                className="react-flow__edge-interaction"
                onContextMenu={onPathContextMenu}
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
                    onContextMenu={e => onCircleContextMenu(e, idx)}
                />
            ))}
        </>
    );
}
