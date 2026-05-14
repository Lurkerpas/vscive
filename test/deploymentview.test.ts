import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDvXml } from '../src/parsers/DvXmlParser';
import { serializeDvXml } from '../src/serializers/DvXmlSerializer';
import { findRelativeFiles, normalizeXml, readUtf8 } from './helpers';

const TASTE_TESTS_ROOT = 'references/TASTE-SAMV71-RTEMS-Tests/tests';

async function getReferenceDeploymentViews(): Promise<string[]> {
    const deploymentViews = await findRelativeFiles(TASTE_TESTS_ROOT, 'deploymentview.dv.xml');
    const samvViews = await findRelativeFiles(TASTE_TESTS_ROOT, 'samv71.dv.xml');
    return [...deploymentViews, ...samvViews].sort((left, right) => left.localeCompare(right));
}

async function assertLoads(relativePath: string): Promise<void> {
    const xml = await readUtf8(relativePath);
    const dv = parseDvXml(xml);
    assert.ok(dv.nodes.length > 0);
    assert.notEqual(dv.version, '');
    assert.ok(dv.connections.length >= 0);
}

async function assertRoundTrips(relativePath: string): Promise<void> {
    const xml = await readUtf8(relativePath);
    const serialized = serializeDvXml(parseDvXml(xml));
    assert.equal(normalizeXml(serialized), normalizeXml(xml));
}

test('loads all TASTE reference deployment view files', async (context) => {
    const referenceDeploymentViews = await getReferenceDeploymentViews();
    assert.ok(referenceDeploymentViews.length > 0);
    for (const relativePath of referenceDeploymentViews) {
        await context.test(relativePath, async () => {
            await assertLoads(relativePath);
        });
    }
});

test('round-trips all TASTE reference deployment view files ignoring whitespace only', async (context) => {
    const referenceDeploymentViews = await getReferenceDeploymentViews();
    assert.ok(referenceDeploymentViews.length > 0);
    for (const relativePath of referenceDeploymentViews) {
        await context.test(relativePath, async () => {
            await assertRoundTrips(relativePath);
        });
    }
});