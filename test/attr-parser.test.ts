import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAttrXml } from '../src/parsers/AttrXmlParser';
import { readUtf8 } from './helpers';

test('loads the reference attributes schema and keeps expected properties', async () => {
    const xml = await readUtf8('references/taste-setup/default_attributes.xml');
    const schema = parseAttrXml(xml);

    assert.ok(schema.attrs.length > 20);

    const language = schema.attrs.find(attr => attr.name === 'language');
    assert.ok(language);
    assert.equal(language.label, 'Language');
    assert.equal(language.visible, false);
    assert.deepEqual(language.scopes, ['Function']);
    assert.equal(language.type.kind, 'enumeration');
    if (language.type.kind === 'enumeration') {
        assert.equal(language.type.defaultValue, 'SDL');
        assert.ok(language.type.entries.includes('Ada'));
        assert.ok(language.type.entries.includes('VHDL'));
    }
    assert.deepEqual(language.scopeValidators.Function, [{ name: 'is_type', value: 'NO' }]);

    const period = schema.attrs.find(attr => attr.name === 'period');
    assert.ok(period);
    assert.deepEqual(period.scopes, ['Provided_Interface']);
    assert.deepEqual(period.scopeValidators.Provided_Interface, [{ name: 'kind', value: 'Cyclic' }]);
    assert.equal(period.type.kind, 'string');
    if (period.type.kind === 'string') {
        assert.equal(period.type.defaultValue, '1000');
        assert.equal(period.type.validator, '\\d+');
    }

    const requiredSystemElement = schema.attrs.find(attr => attr.name === 'required_system_element');
    assert.ok(requiredSystemElement);
    assert.deepEqual(requiredSystemElement.scopes, ['ProvidedInterface', 'RequiredInterface']);
});