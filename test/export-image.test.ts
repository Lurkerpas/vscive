import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS } from '../src/model/types';
import { parseIvXml } from '../src/parsers/IvXmlParser';
import { parseUiXml } from '../src/parsers/UiXmlParser';
import { renderDiagramImage } from '../webview/src/exportImage';
import { buildGraph } from '../webview/src/transform';
import { decodeDataUrl, parseXmlDocument, readUtf8 } from './helpers';
import { encodePngRgba, parsePng } from './png';

const EXPORT_IV = 'references/opus2/demo/ar/taste-components/egse/interfaceview.xml';
const EXPORT_UI = 'references/opus2/demo/ar/taste-components/egse/interfaceview.ui.xml';

function parseHexColor(value: string | undefined, fallback: [number, number, number, number]): [number, number, number, number] {
    if (!value) {
        return fallback;
    }
    const hex = value.trim();
    if (/^#[0-9a-f]{6}$/iu.test(hex)) {
        return [
            Number.parseInt(hex.slice(1, 3), 16),
            Number.parseInt(hex.slice(3, 5), 16),
            Number.parseInt(hex.slice(5, 7), 16),
            255,
        ];
    }
    if (/^#[0-9a-f]{3}$/iu.test(hex)) {
        return [
            Number.parseInt(hex[1] + hex[1], 16),
            Number.parseInt(hex[2] + hex[2], 16),
            Number.parseInt(hex[3] + hex[3], 16),
            255,
        ];
    }
    return fallback;
}

function fillRect(pixels: Uint8Array, width: number, height: number, color: [number, number, number, number], x1: number, y1: number, x2: number, y2: number): void {
    const startX = Math.max(0, Math.min(width, Math.floor(x1)));
    const startY = Math.max(0, Math.min(height, Math.floor(y1)));
    const endX = Math.max(startX, Math.min(width, Math.ceil(x2)));
    const endY = Math.max(startY, Math.min(height, Math.ceil(y2)));

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const index = (y * width + x) * 4;
            pixels[index] = color[0];
            pixels[index + 1] = color[1];
            pixels[index + 2] = color[2];
            pixels[index + 3] = color[3];
        }
    }
}

function synthesizePngFromSvg(svg: string, width: number, height: number): string {
    const backgroundMatch = /<rect\s+width="100%"\s+height="100%"\s+fill="([^"]+)"/u.exec(svg);
    const background = parseHexColor(backgroundMatch?.[1], [255, 255, 255, 255]);
    const accentMatch = /<(?:path|polygon|text|rect)\b[^>]*(?:stroke|fill)="(#[0-9a-f]{3,6})"/iu.exec(svg.replace(backgroundMatch?.[0] ?? '', ''));
    const accent = parseHexColor(accentMatch?.[1], [255 - background[0], 255 - background[1], 255 - background[2], 255]);

    const pixels = new Uint8Array(width * height * 4);
    fillRect(pixels, width, height, background, 0, 0, width, height);

    const hasShapes = (svg.match(/<(?:path|polygon|text|rect)\b/gu) ?? []).length > 1;
    if (hasShapes) {
        fillRect(pixels, width, height, accent, width * 0.2, height * 0.2, width * 0.8, height * 0.8);
    }

    return `data:image/png;base64,${encodePngRgba(width, height, pixels).toString('base64')}`;
}

test('exports a proper non-empty SVG image', async () => {
    const iv = parseIvXml(await readUtf8(EXPORT_IV));
    const ui = parseUiXml(await readUtf8(EXPORT_UI));
    const { nodes, edges } = buildGraph(iv, ui);

    const rendered = await renderDiagramImage({
        nodes,
        edges,
        options: DEFAULT_OPTIONS,
        format: 'svg',
    });

    assert.ok(rendered);
    assert.match(rendered.dataUrl, /^data:image\/svg\+xml;base64,/u);
    const svgText = decodeDataUrl(rendered.dataUrl).toString('utf8');
    const svgDoc = parseXmlDocument(svgText);
    const root = svgDoc.documentElement;
    assert.ok(root);
    assert.equal(root.tagName, 'svg');
    assert.ok(svgText.length > 500);
    assert.ok(Number(root.getAttribute('width') ?? '0') >= 400);
    assert.ok(Number(root.getAttribute('height') ?? '0') >= 300);
    assert.ok((svgText.match(/<(?:rect|path|polygon|text)\b/gu) ?? []).length > 5);
});

test('exports a PNG image with sensible dimensions and varied pixels', async () => {
    const iv = parseIvXml(await readUtf8(EXPORT_IV));
    const ui = parseUiXml(await readUtf8(EXPORT_UI));
    const { nodes, edges } = buildGraph(iv, ui);

    const rendered = await renderDiagramImage({
        nodes,
        edges,
        options: DEFAULT_OPTIONS,
        format: 'png',
        rasterizeSvgToPngDataUrl: async ({ svg, canvasWidth, canvasHeight }) => synthesizePngFromSvg(svg, canvasWidth, canvasHeight),
    });

    assert.ok(rendered);
    assert.match(rendered.dataUrl, /^data:image\/png;base64,/u);
    const png = parsePng(decodeDataUrl(rendered.dataUrl));
    assert.ok(png.width >= 400);
    assert.ok(png.height >= 300);

    const colors = new Set<string>();
    for (let index = 0; index < png.pixels.length; index += 4) {
        colors.add(`${png.pixels[index]},${png.pixels[index + 1]},${png.pixels[index + 2]},${png.pixels[index + 3]}`);
        if (colors.size > 1) {
            break;
        }
    }
    assert.ok(colors.size > 1);
});