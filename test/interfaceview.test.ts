import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIvXml } from '../src/parsers/IvXmlParser';
import { serializeIvXml } from '../src/serializers/IvXmlSerializer';
import { findRelativeFiles, normalizeXml, readUtf8 } from './helpers';

const TASTE_TESTS_ROOT = 'references/TASTE-SAMV71-RTEMS-Tests/tests';

async function getReferenceInterfaceViews(): Promise<string[]> {
    return findRelativeFiles(TASTE_TESTS_ROOT, 'interfaceview.xml');
}

async function assertLoads(relativePath: string): Promise<void> {
    const xml = await readUtf8(relativePath);
    const iv = parseIvXml(xml);
    assert.ok(iv.functions.length > 0);
    assert.notEqual(iv.version, '');
    assert.ok(iv.connections.length >= 0);
}

async function assertRoundTrips(relativePath: string): Promise<void> {
    const xml = await readUtf8(relativePath);
    const serialized = serializeIvXml(parseIvXml(xml));
    assert.equal(normalizeXml(serialized), normalizeXml(xml));
}

test('loads all TASTE reference interfaceview.xml files', async (context) => {
    const referenceInterfaceViews = await getReferenceInterfaceViews();
    assert.ok(referenceInterfaceViews.length > 0);
    for (const relativePath of referenceInterfaceViews) {
        await context.test(relativePath, async () => {
            await assertLoads(relativePath);
        });
    }
});

test('round-trips all TASTE reference interfaceview.xml files ignoring whitespace only', async (context) => {
    const referenceInterfaceViews = await getReferenceInterfaceViews();
    assert.ok(referenceInterfaceViews.length > 0);
    for (const relativePath of referenceInterfaceViews) {
        await context.test(relativePath, async () => {
            await assertRoundTrips(relativePath);
        });
    }
});