import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUiXml } from '../src/parsers/UiXmlParser';

test('parseUiXml prefers bare ids when both bare and brace-wrapped entries exist', () => {
    const ui = parseUiXml(`<?xml version="1.0"?>
<UI version="1.0">
  <Entity id="{88598203-48ac-4c5c-8c37-840233f64a7c}">
    <Taste coordinates="0 0 24000 16000"/>
  </Entity>
  <Entity id="{18bf9c44-c5f9-49f9-85f0-b42737cbd870}">
    <Taste coordinates="16600 0"/>
  </Entity>
  <Entity id="88598203-48ac-4c5c-8c37-840233f64a7c">
    <Taste coordinates="-8000 0 12000 12000"/>
  </Entity>
  <Entity id="18bf9c44-c5f9-49f9-85f0-b42737cbd870">
    <Taste coordinates="12600 4800"/>
  </Entity>
</UI>`);

    assert.deepEqual(Object.keys(ui.entities).sort(), [
        '18bf9c44-c5f9-49f9-85f0-b42737cbd870',
        '88598203-48ac-4c5c-8c37-840233f64a7c',
    ]);
    assert.deepEqual(ui.entities['88598203-48ac-4c5c-8c37-840233f64a7c'], {
        coordinates: [-8000, 0, 12000, 12000],
    });
    assert.deepEqual(ui.entities['18bf9c44-c5f9-49f9-85f0-b42737cbd870'], {
        coordinates: [12600, 4800],
    });
});

  test('parseUiXml preserves brace-wrapped ids when no bare equivalent exists', () => {
    const ui = parseUiXml(`<?xml version="1.0"?>
  <UI version="1.0">
    <Entity id="{0e2ff512-ae12-4511-b2da-c3937a0e2335}">
    <Taste RootCoordinates="32000 -16000 384000 1880000" coordinates="220000 10000 252000 114000"/>
    </Entity>
  </UI>`);

    assert.deepEqual(Object.keys(ui.entities), ['{0e2ff512-ae12-4511-b2da-c3937a0e2335}']);
    assert.deepEqual(ui.entities['{0e2ff512-ae12-4511-b2da-c3937a0e2335}'], {
      coordinates: [220000, 10000, 252000, 114000],
      rootCoordinates: [32000, -16000, 384000, 1880000],
    });
  });