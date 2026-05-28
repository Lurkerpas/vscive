import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS } from '../src/model/types';
import { parsePr } from '../src/parsers/SdlPrParser';
import { buildSdlGraph } from '../webview/src/sdlTransform';
import { renderSdlDiagramImage } from '../webview/src/sdlExportImage';
import { decodeDataUrl, parseXmlDocument } from './helpers';

test('exports a proper non-empty SDL SVG image', async () => {
    const source = [
        'process Exported;',
        '    /* CIF START (20, 20), (70, 35) */',
        '    START;',
        '    /* CIF TEXT (10, 70), (160, 50) */',
        '    dcl charge Integer;',
        '    /* CIF ENDTEXT */',
        '    /* CIF TASK (20, 140), (140, 35) */',
        '    task charge := 1;',
        '    /* CIF RETURN (70, 210), (35, 35) */',
        '    return done;',
        'endprocess Exported;',
    ].join('\n');

    const model = parsePr(source);
    const graph = buildSdlGraph(model.tree, null, DEFAULT_OPTIONS);
    const rendered = await renderSdlDiagramImage({
        nodes: graph.nodes,
        edges: graph.edges,
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
    assert.ok(svgText.includes('sdl-export-arrow'));
    assert.ok((svgText.match(/<(?:rect|path|polygon|circle|text|line)\b/gu) ?? []).length > 5);
});