import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS } from '../src/model/types';
import { parseIvXml } from '../src/parsers/IvXmlParser';
import { parseUiXml } from '../src/parsers/UiXmlParser';
import { renderDiagramImage } from '../webview/src/exportImage';
import { buildGraph } from '../webview/src/transform';
import { decodeDataUrl, parseXmlDocument, readUtf8 } from './helpers';

const EXPORT_IV = 'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-interfaces/TEST-SAMV71-INTERFACES/interfaceview.xml';
const EXPORT_UI = 'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-interfaces/TEST-SAMV71-INTERFACES/interfaceview.ui.xml';

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