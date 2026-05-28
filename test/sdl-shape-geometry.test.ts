import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inputShapePoints, outputShapePoints } from '../webview/src/sdlShapeGeometry';

function parsePoints(points: string): Array<{ x: number; y: number }> {
    return points.split(' ').map(pair => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
    });
}

describe('SDL shape geometry', () => {
    it('renders input with a small triangle cut out from the right edge', () => {
        const points = parsePoints(inputShapePoints(100, 40, 2));

        assert.deepStrictEqual(points, [
            { x: 1, y: 1 },
            { x: 99, y: 1 },
            { x: 88, y: 20 },
            { x: 99, y: 39 },
            { x: 1, y: 39 },
        ]);
    });

    it('renders output with a small triangle appended on the right edge', () => {
        const points = parsePoints(outputShapePoints(100, 40, 2));

        assert.deepStrictEqual(points, [
            { x: 1, y: 1 },
            { x: 88, y: 1 },
            { x: 99, y: 20 },
            { x: 88, y: 39 },
            { x: 1, y: 39 },
        ]);
    });
});