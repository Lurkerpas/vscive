export function inputShapePoints(w: number, h: number, strokeWidth: number, cut = 11): string {
    const pad = strokeWidth / 2;
    return [
        `${pad},${pad}`,
        `${w - pad},${pad}`,
        `${w - pad - cut},${h / 2}`,
        `${w - pad},${h - pad}`,
        `${pad},${h - pad}`,
    ].join(' ');
}

export function outputShapePoints(w: number, h: number, strokeWidth: number, tip = 11): string {
    const pad = strokeWidth / 2;
    return [
        `${pad},${pad}`,
        `${w - pad - tip},${pad}`,
        `${w - pad},${h / 2}`,
        `${w - pad - tip},${h - pad}`,
        `${pad},${h - pad}`,
    ].join(' ');
}

export interface LineSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export function returnCrossLines(w: number, h: number, strokeWidth: number): LineSegment[] {
    const inset = Math.max(strokeWidth + 2, Math.round(Math.min(w, h) * 0.25));
    return [
        { x1: inset, y1: inset, x2: w - inset, y2: h - inset },
        { x1: w - inset, y1: inset, x2: inset, y2: h - inset },
    ];
}