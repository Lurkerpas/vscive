import type { Edge, Node } from '@xyflow/react';
import { EditorOptions } from '../../src/model/types';
import { IFACE_H, IFACE_W } from './transform';

export interface DiagramImage {
    svg: string;
    dataUrl: string;
    width: number;
    height: number;
}

export interface RasterizeSvgParams {
    svg: string;
    canvasWidth: number;
    canvasHeight: number;
}

export interface RenderDiagramImageParams {
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

function nodeDimensions(node: Node, fallbackWidth: number, fallbackHeight: number): { width: number; height: number } {
    const data = node.data as Record<string, unknown> | undefined;
    const styleWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
    const styleHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
    const width = node.measured?.width ?? styleWidth ?? (typeof data?.ifaceWidth === 'number' ? data.ifaceWidth : undefined) ?? fallbackWidth;
    const height = node.measured?.height ?? styleHeight ?? (typeof data?.ifaceHeight === 'number' ? data.ifaceHeight : undefined) ?? fallbackHeight;
    return { width, height };
}

function absoluteNodePosition(node: Node, nodeMap: Map<string, Node>): { x: number; y: number } {
    if (!node.parentId) {
        return { x: node.position.x, y: node.position.y };
    }
    const parent = nodeMap.get(node.parentId);
    if (!parent) {
        return { x: node.position.x, y: node.position.y };
    }
    const parentPosition = absoluteNodePosition(parent, nodeMap);
    return {
        x: parentPosition.x + node.position.x,
        y: parentPosition.y + node.position.y,
    };
}

function scaleSvg(svg: string, width: number, height: number, canvasWidth: number, canvasHeight: number): string {
    return svg.replace(
        `width="${width}" height="${height}"`,
        `width="${canvasWidth}" height="${canvasHeight}"`,
    );
}

export function buildDiagramSvg(nodes: Node[], edges: Edge[], options: EditorOptions): DiagramImage | null {
    if (nodes.length === 0) {
        return null;
    }

    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
        const position = absoluteNodePosition(node, nodeMap);
        const { width, height } = nodeDimensions(node, IFACE_W, IFACE_H);
        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
        maxX = Math.max(maxX, position.x + width);
        maxY = Math.max(maxY, position.y + height);
    }

    const pad = 60;
    const width = Math.max(maxX - minX + pad * 2, 400);
    const height = Math.max(maxY - minY + pad * 2, 300);
    const offsetX = pad - minX;
    const offsetY = pad - minY;

    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
    parts.push(`<rect width="100%" height="100%" fill="${options.canvasColor}"/>`);

    for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) {
            continue;
        }

        const sourcePos = absoluteNodePosition(source, nodeMap);
        const targetPos = absoluteNodePosition(target, nodeMap);
        const sourceDims = nodeDimensions(source, IFACE_W, IFACE_H);
        const targetDims = nodeDimensions(target, IFACE_W, IFACE_H);
        const sourceEdge = ((source.data as Record<string, unknown> | undefined)?.edge as string | undefined) ?? 'left';
        const targetEdge = ((target.data as Record<string, unknown> | undefined)?.edge as string | undefined) ?? 'left';

        const handleX = (position: { x: number; y: number }, edgeName: string, nodeWidth: number) => {
            switch (edgeName) {
                case 'right':
                    return position.x + offsetX + nodeWidth;
                case 'top':
                case 'bottom':
                    return position.x + offsetX + nodeWidth / 2;
                default:
                    return position.x + offsetX;
            }
        };

        const handleY = (position: { x: number; y: number }, edgeName: string, nodeHeight: number) => {
            switch (edgeName) {
                case 'top':
                    return position.y + offsetY;
                case 'bottom':
                    return position.y + offsetY + nodeHeight;
                default:
                    return position.y + offsetY + nodeHeight / 2;
            }
        };

        const sx = handleX(sourcePos, sourceEdge, sourceDims.width);
        const sy = handleY(sourcePos, sourceEdge, sourceDims.height);
        const tx = handleX(targetPos, targetEdge, targetDims.width);
        const ty = handleY(targetPos, targetEdge, targetDims.height);
        const deltaX = Math.abs(tx - sx) * 0.5;
        const strokeWidth = Math.max(2, IFACE_W * 0.05);

        parts.push(`<path d="M${sx},${sy} C${sx + deltaX},${sy} ${tx - deltaX},${ty} ${tx},${ty}" stroke="${options.ivConnectionColor}" stroke-width="${strokeWidth}" fill="none"/>`);
        if (options.showConnectionLabels && edge.label) {
            const label = String(edge.label);
            const labelX = (sx + tx) / 2;
            const labelY = (sy + ty) / 2;
            const labelFontSize = Math.max(6, options.fontSizeConn);
            const labelWidth = label.length * labelFontSize * 0.6 + 12;
            parts.push(`<rect x="${labelX - labelWidth / 2}" y="${labelY - labelFontSize - 2}" width="${labelWidth}" height="${labelFontSize + 6}" fill="${options.canvasColor}" rx="3"/>`);
            parts.push(`<text x="${labelX}" y="${labelY}" text-anchor="middle" fill="${options.ivConnectionFontColor}" font-size="${labelFontSize}" font-family="sans-serif">${escapeXml(label)}</text>`);
        }
    }

    for (const node of nodes.filter(entry => entry.type === 'functionNode')) {
        const position = absoluteNodePosition(node, nodeMap);
        const x = position.x + offsetX;
        const y = position.y + offsetY;
        const { width: nodeWidth, height: nodeHeight } = nodeDimensions(node, 200, 100);
        const data = node.data as Record<string, unknown>;
        const caption = data.language ? `${String(data.label ?? '')} [${String(data.language)}]` : String(data.label ?? '');
        const fontSize = typeof data.fontSizeFn === 'number' ? data.fontSizeFn : 90;
        const headerHeight = Math.round(fontSize * 1.2 + 12);
        const textY = y + 2 + headerHeight * 0.7;

        parts.push(`<rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" fill="#1e1e2e" stroke="${options.ivFunctionColor}" stroke-width="3" rx="6"/>`);
        parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${nodeWidth - 4}" height="${headerHeight}" fill="${options.ivFunctionColor}" rx="4"/>`);
        parts.push(`<rect x="${x + 2}" y="${y + 2 + headerHeight / 2}" width="${nodeWidth - 4}" height="${headerHeight / 2}" fill="${options.ivFunctionColor}"/>`);
        parts.push(`<line x1="${x}" y1="${y + headerHeight + 2}" x2="${x + nodeWidth}" y2="${y + headerHeight + 2}" stroke="${options.ivFunctionColor}" stroke-width="1"/>`);
        parts.push(`<text x="${x + 10}" y="${textY}" fill="${options.ivFunctionFontColor}" font-size="${fontSize}" font-weight="bold" font-family="sans-serif">${escapeXml(caption)}</text>`);
    }

    for (const node of nodes.filter(entry => entry.type === 'interfaceNode')) {
        const position = absoluteNodePosition(node, nodeMap);
        const x = position.x + offsetX;
        const y = position.y + offsetY;
        const { width: nodeWidth, height: nodeHeight } = nodeDimensions(node, IFACE_W, IFACE_H);
        const data = node.data as Record<string, unknown>;
        const iface = data.iface as { kind: string; type: string; name: string };
        const edgeName = (data.edge as string | undefined) ?? 'left';
        const color = options.ivInterfaceColor;
        const fontSize = typeof data.fontSizeIface === 'number' ? data.fontSizeIface : 45;

        const tipDirection = iface.type === 'provided'
            ? (edgeName === 'left' ? 'right' : edgeName === 'right' ? 'left' : edgeName === 'top' ? 'down' : 'up')
            : edgeName;

        let points: string;
        switch (tipDirection) {
            case 'right':
                points = `${x},${y} ${x},${y + nodeHeight} ${x + nodeWidth},${y + nodeHeight / 2}`;
                break;
            case 'left':
                points = `${x + nodeWidth},${y} ${x + nodeWidth},${y + nodeHeight} ${x},${y + nodeHeight / 2}`;
                break;
            case 'down':
                points = `${x},${y} ${x + nodeWidth},${y} ${x + nodeWidth / 2},${y + nodeHeight}`;
                break;
            default:
                points = `${x},${y + nodeHeight} ${x + nodeWidth},${y + nodeHeight} ${x + nodeWidth / 2},${y}`;
                break;
        }
        parts.push(`<polygon points="${points}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="2"/>`);

        if (options.showInterfaceNames) {
            const gap = 8;
            let labelX: number;
            let labelY: number;
            let anchor: 'start' | 'end' | 'middle';

            switch (edgeName) {
                case 'left':
                    labelX = x + nodeWidth + gap;
                    labelY = y + nodeHeight / 2 + fontSize * 0.35;
                    anchor = 'start';
                    break;
                case 'right':
                    labelX = x - gap;
                    labelY = y + nodeHeight / 2 + fontSize * 0.35;
                    anchor = 'end';
                    break;
                case 'top':
                    labelX = x + nodeWidth / 2;
                    labelY = y + nodeHeight + gap + fontSize;
                    anchor = 'middle';
                    break;
                default:
                    labelX = x + nodeWidth / 2;
                    labelY = y - gap;
                    anchor = 'middle';
                    break;
            }

            parts.push(`<text x="${labelX}" y="${labelY}" text-anchor="${anchor}" fill="${options.ivInterfaceFontColor}" font-size="${fontSize}" font-family="sans-serif">${escapeXml(iface.name)}</text>`);
        }
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

export async function renderDiagramImage({
    nodes,
    edges,
    options,
    format,
    rasterizeSvgToPngDataUrl,
}: RenderDiagramImageParams): Promise<DiagramImage | null> {
    const svgImage = buildDiagramSvg(nodes, edges, options);
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