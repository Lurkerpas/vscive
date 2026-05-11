import React from 'react';
import { EdgeProps, BaseEdge, useReactFlow } from '@xyflow/react';
import { post } from '../vscodeApi';
import { useEdgeMenu } from './EdgeMenuContext';
import { Waypoint, WAYPOINT_NODE_SIZE, makeWaypointNodeId } from '../waypoints';


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
    label, selected, data, style,
}: EdgeProps) {
    const { screenToFlowPosition, setNodes } = useReactFlow();
    const { showContextMenu } = useEdgeMenu();
    const edgeData = (data as {
        waypoints?: Waypoint[];
        locked?: boolean;
        fontSizeConn?: number;
        canvasColor?: string;
        showConnectionLabels?: boolean;
        waypointSize?: number;
    }) ?? {};
    const waypoints: Waypoint[] = edgeData.waypoints ?? [];
    const locked = edgeData.locked ?? false;
    const labelFontSize = edgeData.fontSizeConn ?? 11;
    const labelBg = edgeData.canvasColor ?? '#1e1e2e';
    const showConnectionLabels = edgeData.showConnectionLabels ?? true;
    const waypointSize = Math.max(edgeData.waypointSize ?? WAYPOINT_NODE_SIZE, 6);

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
    const labelText = typeof label === 'string' || typeof label === 'number' ? String(label) : '';
    const labelPaddingX = 6;
    const labelPaddingY = 3;
    const labelWidth = labelText.length * labelFontSize * 0.6 + labelPaddingX * 2;
    const labelHeight = labelFontSize + labelPaddingY * 2;

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
                                x: wp.x - waypointSize / 2,
                                y: wp.y - waypointSize / 2,
                            },
                            width: waypointSize,
                            height: waypointSize,
                            measured: { width: waypointSize, height: waypointSize },
                            draggable: true,
                            selectable: true,
                            deletable: true,
                            data: { connectionId: id, waypointIndex: index, waypointSize },
                            style: { width: waypointSize, height: waypointSize },
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
                style={{ ...style, stroke: selected ? '#89b4fa' : undefined }}
            />
            {showConnectionLabels && labelText && (
                <g transform={`translate(${labelX}, ${labelY})`} style={{ pointerEvents: 'none' }}>
                    <rect
                        x={-labelWidth / 2}
                        y={-labelHeight / 2}
                        width={labelWidth}
                        height={labelHeight}
                        rx={3}
                        fill={labelBg}
                    />
                    <text
                        x={0}
                        y={labelFontSize * 0.35}
                        textAnchor="middle"
                        fill="#cdd6f4"
                        fontSize={labelFontSize}
                        fontFamily="sans-serif"
                    >
                        {labelText}
                    </text>
                </g>
            )}
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
