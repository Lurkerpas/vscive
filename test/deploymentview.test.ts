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

test('DV parsing and serialization prefer brace-wrapped UUID ids', () => {
        const xml = `<?xml version="1.0"?>
<DeploymentView version="1.0" UiFile="deploymentview.ui.xml">
    <Node id="88598203-48ac-4c5c-8c37-840233f64a7c" name="Node_1" type="Board">
        <Partition id="18bf9c44-c5f9-49f9-85f0-b42737cbd870" name="Partition_1">
            <Function id="2f53a9e2-9139-4db0-9af5-bc35cc7f0ac0" name="Function" path="work/function"/>
        </Partition>
        <Device id="b3f0b459-0c45-43fe-b4b9-5b20b4c8fe29" name="Device_1"/>
    </Node>
    <Connection id="4996daf3-818b-4f5d-835a-a6d38f441564" name="Conn_1" from_node="Node_1" from_port="A" to_node="Node_2" to_port="B">
        <Message id="67a56303-b755-4790-8eec-3e19f6dd7a0e" name="Message_1" from_function="Function" from_interface="PI" to_function="Other" to_interface="RI"/>
    </Connection>
</DeploymentView>`;

        const dv = parseDvXml(xml);
        assert.equal(dv.nodes[0].id, '{88598203-48ac-4c5c-8c37-840233f64a7c}');
        assert.equal(dv.nodes[0].partition.id, '{18bf9c44-c5f9-49f9-85f0-b42737cbd870}');
        assert.equal(dv.nodes[0].partition.functions[0].id, '{2f53a9e2-9139-4db0-9af5-bc35cc7f0ac0}');
        assert.equal(dv.nodes[0].devices[0].id, '{b3f0b459-0c45-43fe-b4b9-5b20b4c8fe29}');
        assert.equal(dv.connections[0].id, '{4996daf3-818b-4f5d-835a-a6d38f441564}');
        assert.equal(dv.connections[0].messages[0].id, '{67a56303-b755-4790-8eec-3e19f6dd7a0e}');

        const serialized = serializeDvXml(dv);
        assert.match(serialized, /Node id="\{88598203-48ac-4c5c-8c37-840233f64a7c\}"/u);
        assert.match(serialized, /Partition id="\{18bf9c44-c5f9-49f9-85f0-b42737cbd870\}"/u);
        assert.match(serialized, /Function id="\{2f53a9e2-9139-4db0-9af5-bc35cc7f0ac0\}"/u);
        assert.match(serialized, /Device id="\{b3f0b459-0c45-43fe-b4b9-5b20b4c8fe29\}"/u);
        assert.match(serialized, /Connection id="\{4996daf3-818b-4f5d-835a-a6d38f441564\}"/u);
        assert.match(serialized, /Message id="\{67a56303-b755-4790-8eec-3e19f6dd7a0e\}"/u);
});