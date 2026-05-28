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