import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIvXml } from '../src/parsers/IvXmlParser';
import { readUtf8 } from './helpers';

const REFERENCE_INTERFACE_VIEWS = [
    'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-interfaces/TEST-SAMV71-INTERFACES/interfaceview.xml',
    'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-parameter-encoding/TEST-SAMV71-PARAMETER-ENCODING/interfaceview.xml',
    'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-can/samv71-rtems-can-simple/interfaceview.xml',
    'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-cpp/interfaceview.xml',
    'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-queue-overflow/TEST-SAMV71-QUEUE-OVERFLOW/interfaceview.xml',
    'references/TASTE-SAMV71-RTEMS-Tests/tests/samv71-rtems-time-resolution/TEST-SAMV71-TIME-RESOLUTION/interfaceview.xml',
];

test('loads various reference interfaceview.xml files', async (context) => {
    for (const relativePath of REFERENCE_INTERFACE_VIEWS) {
        await context.test(relativePath, async () => {
            const xml = await readUtf8(relativePath);
            const iv = parseIvXml(xml);
            assert.ok(iv.functions.length > 0);
            assert.notEqual(iv.version, '');
            assert.ok(iv.connections.length >= 0);
        });
    }
});