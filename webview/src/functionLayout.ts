import { DEFAULT_OPTIONS } from '../../src/model/types';

export function functionHeaderHeight(fontScale: number, fontSize = DEFAULT_OPTIONS.fontSizeFn * Math.max(fontScale, 0.05)): number {
    const normalizedScale = Math.max(fontScale, 0.05);
    const paddingY = Math.max(2, 6 * normalizedScale);
    const lineHeight = fontSize * 1.2;
    return Math.max(Math.ceil(lineHeight + paddingY * 2 + 1), 1);
}

export function functionContentRect(width: number, height: number, fontScale: number): { x: number; y: number; width: number; height: number } {
    const headerHeightPx = Math.min(functionHeaderHeight(fontScale), Math.max(height - 1, 0));
    return {
        x: 0,
        y: headerHeightPx,
        width,
        height: Math.max(height - headerHeightPx, 1),
    };
}