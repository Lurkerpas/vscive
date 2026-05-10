import React from 'react';
import { EdgeProps, BaseEdge, useReactFlow } from '@xyflow/react';
import { post } from '../vscodeApi';
import { useEdgeMenu } from './EdgeMenuContext';
import { Waypoint, WAYPOINT_NODE_RADIUS, WAYPOINT_NODE_SIZE, makeWaypointNodeId } from '../waypoints';


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
    const { screenToFlowPosition, setNodes } = useReactFlow();
    const { showContextMenu } = useEdgeMenu();
    const waypoints: Waypoint[] = (data as { waypoints?: Waypoint[] })?.waypoints ?? [];
    const locked = (data as { locked?: boolean })?.locked ?? false;

    // Build polyline path: source → waypoints → target
    const allPts = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }];
    let pathD = `M ${allPts[0].x},${allPts[0].y}`;
    for (let i = 1; i < allPts.length; i++) {
        pathD += ` L ${allPts[i].x},${allPts[i].y}`;
    }

    // Label position: midpoint of the middle segment
    const midI = Math.max(1, Math.floor(allPts.length / 2));
    const labelX = (allPts[midI - 1].x + allPts[midI].x) / 2;
    const labelY = (allPts[midI - 1].y + allPts[midI].y) / 2;

    // ── Edge path right-click → "Add Node" / "Remove Connection" ─────────
    const onPathContextMenu = (e: React.MouseEvent) => {
        if (locked) { return; }
        e.preventDefault();
        e.stopPropagation();
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        // Compute nearest-segment insertion eagerly so the position is captured at right-click time
        const { wps: insertedWps } = nearestSegmentInsertion(pos, allPts, waypoints);
        showContextMenu(e.clientX, e.clientY, [
            {
                label: 'Add Node',
                onClick: () => {
                    setNodes(nodes => [
                        ...nodes.filter(n => !n.id.startsWith(`${id}::wp::`)),
                        ...insertedWps.map((wp, index) => ({
                            id: makeWaypointNodeId(id, index),
                            type: 'waypointNode',
                            position: {
                                x: wp.x - WAYPOINT_NODE_RADIUS,
                                y: wp.y - WAYPOINT_NODE_RADIUS,
                            },
                            width: WAYPOINT_NODE_SIZE,
                            height: WAYPOINT_NODE_SIZE,
                            measured: { width: WAYPOINT_NODE_SIZE, height: WAYPOINT_NODE_SIZE },
                            draggable: true,
                            selectable: true,
                            deletable: true,
                            data: { connectionId: id, waypointIndex: index },
                            style: { width: WAYPOINT_NODE_SIZE, height: WAYPOINT_NODE_SIZE },
                        })),
                    ]);
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
        </>
    );
}
