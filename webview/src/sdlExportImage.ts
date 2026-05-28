import type { Edge, Node } from '@xyflow/react';
import { EditorOptions, SdlSymbolKind } from '../../src/model/types';
import type { DiagramImage, RasterizeSvgParams } from './exportImage';
import { inputShapePoints, outputShapePoints, returnCrossLines } from './sdlShapeGeometry';
import { formatSdlDisplayText, shouldLeftAlignSdlText } from './sdlTextLayout';
import { SdlEdgeData, SdlNodeData, sdlFillColor } from './sdlTransform';

interface RenderSdlDiagramImageParams {
    nodes: Node[];
    edges: Edge[];
    options: EditorOptions;
    format: 'png' | 'svg';
    rasterizeSvgToPngDataUrl?: (params: RasterizeSvgParams) => Promise<string | null>;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function encodeBase64Utf8(value: string): string {
    const runtime = globalThis as typeof globalThis & {
        Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
    };
    if (runtime.Buffer) {
        return runtime.Buffer.from(value, 'utf8').toString('base64');
    }
    return btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(''));
}

function toSvgDataUrl(svg: string): string {
    return `data:image/svg+xml;base64,${encodeBase64Utf8(svg)}`;
}

function scaleSvg(svg: string, width: number, height: number, canvasWidth: number, canvasHeight: number): string {
    return svg.replace(
        `width="${width}" height="${height}"`,
        `width="${canvasWidth}" height="${canvasHeight}"`,
    );
}

function nodeDimensions(node: Node, fallbackWidth: number, fallbackHeight: number): { width: number; height: number } {
    const styleWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
    const styleHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
    const width = node.measured?.width ?? node.width ?? styleWidth ?? fallbackWidth;
    const height = node.measured?.height ?? node.height ?? styleHeight ?? fallbackHeight;
    return { width, height };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function shapeMarkup(kind: SdlSymbolKind, x: number, y: number, w: number, h: number, fill: string, stroke: string, strokeWidth: number): string {
    const pad = strokeWidth / 2;
    switch (kind) {
        case 'start':
        case 'nextstate': {
            const rx = Math.min(h / 2, w / 2);
            return `<rect x="${x + pad}" y="${y + pad}" width="${w - strokeWidth}" height="${h - strokeWidth}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        }
        case 'return': {
            const cx = x + w / 2;
            const cy = y + h / 2;
            const r = Math.min(w, h) / 2 - strokeWidth / 2;
            const cross = returnCrossLines(w, h, strokeWidth)
                .map(line => `<line x1="${x + line.x1}" y1="${y + line.y1}" x2="${x + line.x2}" y2="${y + line.y2}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`)
                .join('');
            return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>${cross}</g>`;
        }
        case 'state': {
            const rx = Math.min(h / 4, w / 4);
            return `<rect x="${x + pad}" y="${y + pad}" width="${w - strokeWidth}" height="${h - strokeWidth}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        }
        case 'stateAggregation': {
            const inner = 4;
            return `<g>
                <rect x="${x + pad}" y="${y + pad}" width="${w - strokeWidth}" height="${h - strokeWidth}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
                <line x1="${x + inner + pad}" y1="${y + pad}" x2="${x + inner + pad}" y2="${y + h - pad}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
                <line x1="${x + w - inner - pad}" y1="${y + pad}" x2="${x + w - inner - pad}" y2="${y + h - pad}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
            </g>`;
        }
        case 'input':
        case 'continuousSignal':
            return `<polygon points="${inputShapePoints(w, h, strokeWidth).split(' ').map(pair => {
                const [px, py] = pair.split(',').map(Number);
                return `${x + px},${y + py}`;
            }).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        case 'output':
            return `<polygon points="${outputShapePoints(w, h, strokeWidth).split(' ').map(pair => {
                const [px, py] = pair.split(',').map(Number);
                return `${x + px},${y + py}`;
            }).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        case 'task':
        case 'answer':
            return `<rect x="${x + pad}" y="${y + pad}" width="${w - strokeWidth}" height="${h - strokeWidth}" rx="4" ry="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        case 'decision':
        case 'alternative': {
            const cx = x + w / 2;
            const cy = y + h / 2;
            const points = `${cx},${y + pad} ${x + w - pad},${cy} ${cx},${y + h - pad} ${x + pad},${cy}`;
            return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        }
        case 'procedure':
        case 'procedureCall': {
            const inner = 4;
            return `<g>
                <rect x="${x + pad}" y="${y + pad}" width="${w - strokeWidth}" height="${h - strokeWidth}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
                <line x1="${x + inner + pad}" y1="${y + pad}" x2="${x + inner + pad}" y2="${y + h - pad}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
                <line x1="${x + w - inner - pad}" y1="${y + pad}" x2="${x + w - inner - pad}" y2="${y + h - pad}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
            </g>`;
        }
        case 'join': {
            const cx = x + w / 2;
            const cy = y + h / 2;
            const r = Math.min(w, h) / 2 - strokeWidth / 2;
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        }
        case 'label': {
            const cx = x + w / 2;
            const cy = y + h / 2;
            const r = Math.min(w, h) / 2 - strokeWidth / 2;
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
        }
        case 'connect': {
            const cx = x + w / 2;
            const cy = y + h / 2;
            const r1 = Math.min(w, h) / 2 - strokeWidth / 2;
            const r2 = r1 * 0.7;
            return `<g>
                <circle cx="${cx}" cy="${cy}" r="${r1}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
                <circle cx="${cx}" cy="${cy}" r="${r2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
            </g>`;
        }
        case 'comment': {
            const corner = 12;
            const points = `${x + pad},${y + pad} ${x + w - pad - corner},${y + pad} ${x + w - pad},${y + pad + corner} ${x + w - pad},${y + h - pad} ${x + pad},${y + h - pad}`;
            return `<g>
                <polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
                <polyline points="${x + w - pad - corner},${y + pad} ${x + w - pad - corner},${y + pad + corner} ${x + w - pad},${y + pad + corner}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>
            </g>`;
        }
        case 'textArea':
            return `<rect x="${x + pad}" y="${y + pad}" width="${w - strokeWidth}" height="${h - strokeWidth}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="6 3"/>`;
        default:
            return `<rect x="${x + pad}" y="${y + pad}" width="${w - strokeWidth}" height="${h - strokeWidth}" rx="4" ry="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    }
}

function textMarkup(kind: SdlSymbolKind, text: string, hasChildren: boolean, x: number, y: number, w: number, h: number, options: EditorOptions, strokeWidth: number): string {
    const leftAligned = shouldLeftAlignSdlText(kind);
    const fontSize = options.sdlFontSize;
    const lineHeight = fontSize + 2;
    const lines = text.split('\n');
    if (hasChildren && lines.length > 0 && kind !== 'return') {
        lines[lines.length - 1] = `${lines[lines.length - 1]} ▶`;
    }
    const totalHeight = lines.length * lineHeight;
    const allowOverflow = kind === 'return';
    const anchor = leftAligned ? 'start' : 'middle';
    const baseX = leftAligned ? x + strokeWidth + 6 : x + w / 2;
    const startY = leftAligned
        ? y + strokeWidth + fontSize + 4
        : y + (h - totalHeight) / 2 + fontSize;

    const tspans = lines.map((line, index) => `<tspan x="${baseX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('');
    return `<text x="${baseX}" y="${startY}" text-anchor="${anchor}" fill="${options.sdlDefaultTextColor}" font-size="${fontSize}" font-family="monospace"${allowOverflow ? '' : ''}>${tspans}</text>`;
}

function edgePath(edge: Edge, nodeMap: Map<string, Node>, offsetX: number, offsetY: number): string | null {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) return null;

    const sourceDims = nodeDimensions(source, 150, 60);
    const targetDims = nodeDimensions(target, 150, 60);
    const sourceX = source.position.x + offsetX + sourceDims.width / 2;
    const sourceY = source.position.y + offsetY + sourceDims.height;
    const targetX = target.position.x + offsetX + targetDims.width / 2;
    const targetY = target.position.y + offsetY;
    const edgeData = (edge.data as SdlEdgeData | undefined) ?? { kind: 'vertical' };

    if (edgeData.kind === 'rake') {
        const elbowY = Math.min(sourceY + 10, sourceY + Math.max((targetY - sourceY) / 2, 0));
        return `M ${sourceX},${sourceY} L ${sourceX},${elbowY} L ${targetX},${elbowY} L ${targetX},${targetY}`;
    }

    const targetLeft = target.position.x + offsetX;
    const targetRight = targetLeft + targetDims.width;
    const landingX = clamp(sourceX, targetLeft, targetRight);

    if (Math.abs(landingX - sourceX) < 0.5) {
        return `M ${sourceX},${sourceY} L ${landingX},${targetY}`;
    }

    const elbowY = sourceY + Math.max((targetY - sourceY) / 2, 10);
    return `M ${sourceX},${sourceY} L ${sourceX},${elbowY} L ${landingX},${elbowY} L ${landingX},${targetY}`;
}

export function buildSdlDiagramSvg(nodes: Node[], edges: Edge[], options: EditorOptions): DiagramImage | null {
    if (nodes.length === 0) {
        return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
        const { width, height } = nodeDimensions(node, 150, 60);
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + width);
        maxY = Math.max(maxY, node.position.y + height);
    }

    const pad = 60;
    const width = Math.max(maxX - minX + pad * 2, 400);
    const height = Math.max(maxY - minY + pad * 2, 300);
    const offsetX = pad - minX;
    const offsetY = pad - minY;
    const nodeMap = new Map(nodes.map(node => [node.id, node]));

    const parts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
        '<defs>',
        `<marker id="sdl-export-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${options.sdlConnectionColor}"/></marker>`,
        '</defs>',
        `<rect width="100%" height="100%" fill="${options.sdlCanvasColor}"/>`,
    ];

    for (const edge of edges) {
        const path = edgePath(edge, nodeMap, offsetX, offsetY);
        if (!path) continue;
        parts.push(`<path d="${path}" stroke="${options.sdlConnectionColor}" stroke-width="${Math.max(1, options.sdlConnectionThickness)}" fill="none" marker-end="url(#sdl-export-arrow)"/>`);
    }

    for (const node of nodes) {
        const data = node.data as SdlNodeData;
        const { width: nodeWidth, height: nodeHeight } = nodeDimensions(node, 150, 60);
        const x = node.position.x + offsetX;
        const y = node.position.y + offsetY;
        const strokeWidth = options.sdlConnectionThickness;
        const fill = sdlFillColor(data.kind, options);
        const stroke = options.sdlDefaultBorderColor;
        const displayText = formatSdlDisplayText(data.kind, data.text);

        parts.push(shapeMarkup(data.kind, x, y, nodeWidth, nodeHeight, fill, stroke, strokeWidth));
        parts.push(textMarkup(data.kind, displayText, data.hasChildren, x, y, nodeWidth, nodeHeight, options, strokeWidth));
    }

    parts.push('</svg>');
    const svg = parts.join('\n');
    return {
        svg,
        dataUrl: toSvgDataUrl(svg),
        width,
        height,
    };
}

export async function renderSdlDiagramImage({ nodes, edges, options, format, rasterizeSvgToPngDataUrl }: RenderSdlDiagramImageParams): Promise<DiagramImage | null> {
    const svgImage = buildSdlDiagramSvg(nodes, edges, options);
    if (!svgImage) {
        return null;
    }

    if (format === 'svg') {
        return svgImage;
    }

    const maxPngPx = 8192;
    const pngScale = Math.min(1, maxPngPx / Math.max(svgImage.width, svgImage.height));
    const canvasWidth = Math.max(1, Math.round(svgImage.width * pngScale));
    const canvasHeight = Math.max(1, Math.round(svgImage.height * pngScale));
    const pngDataUrl = rasterizeSvgToPngDataUrl
        ? await rasterizeSvgToPngDataUrl({
            svg: scaleSvg(svgImage.svg, svgImage.width, svgImage.height, canvasWidth, canvasHeight),
            canvasWidth,
            canvasHeight,
        })
        : null;

    return {
        ...svgImage,
        dataUrl: pngDataUrl && pngDataUrl !== 'data:,' ? pngDataUrl : svgImage.dataUrl,
    };
}