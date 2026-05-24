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

test('IV parsing and serialization prefer brace-wrapped UUID ids', () => {
        const xml = `<?xml version="1.0"?>
<InterfaceView version="1.0" UiFile="interfaceview.ui.xml">
    <Function id="88598203-48ac-4c5c-8c37-840233f64a7c" name="Function" is_type="NO" language="C" default_implementation="default" fixed_system_element="NO" required_system_element="NO">
        <Provided_Interface id="18bf9c44-c5f9-49f9-85f0-b42737cbd870" name="trigger" kind="Cyclic"></Provided_Interface>
        <Implementations>
            <Implementation name="default" language="C"/>
        </Implementations>
    </Function>
    <Connection id="2f53a9e2-9139-4db0-9af5-bc35cc7f0ac0">
        <Source iface_id="18bf9c44-c5f9-49f9-85f0-b42737cbd870" func_name="Function" ri_name="trigger"/>
        <Target iface_id="18bf9c44-c5f9-49f9-85f0-b42737cbd870" func_name="Function" pi_name="trigger"/>
    </Connection>
</InterfaceView>`;

        const iv = parseIvXml(xml);
        assert.equal(iv.functions[0].id, '{88598203-48ac-4c5c-8c37-840233f64a7c}');
        assert.equal(iv.functions[0].providedInterfaces[0].id, '{18bf9c44-c5f9-49f9-85f0-b42737cbd870}');
        assert.equal(iv.connections[0].id, '{2f53a9e2-9139-4db0-9af5-bc35cc7f0ac0}');
        assert.equal(iv.connections[0].sourceIfaceId, '{18bf9c44-c5f9-49f9-85f0-b42737cbd870}');

        const serialized = serializeIvXml(iv);
        assert.match(serialized, /Function id="\{88598203-48ac-4c5c-8c37-840233f64a7c\}"/u);
        assert.match(serialized, /Provided_Interface id="\{18bf9c44-c5f9-49f9-85f0-b42737cbd870\}"/u);
        assert.match(serialized, /Connection id="\{2f53a9e2-9139-4db0-9af5-bc35cc7f0ac0\}"/u);
        assert.match(serialized, /iface_id="\{18bf9c44-c5f9-49f9-85f0-b42737cbd870\}"/u);
});