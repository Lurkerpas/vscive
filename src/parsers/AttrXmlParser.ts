import { DOMParser, Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import { AttributeSchema, AttrDef, EntityScope, EnumerationType, StringType } from '../model/types';

function childElements(el: XmlElement | XmlDocument, tagName: string): XmlElement[] {
    const out: XmlElement[] = [];
    const nodes = el.childNodes;
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.nodeType === 1 && (n as XmlElement).tagName === tagName) {
            out.push(n as XmlElement);
        }
    }
    return out;
}

const SCOPE_TAGS: EntityScope[] = [
    'Function', 'Provided_Interface', 'Required_Interface',
    'ProvidedInterface', 'RequiredInterface',
];

export function parseAttrXml(xml: string): AttributeSchema {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) { return EMPTY_SCHEMA; }
    const attrs: AttrDef[] = [];

    for (const attrEl of childElements(root, 'Attr')) {
        const label = attrEl.getAttribute('label') ?? '';
        const name = attrEl.getAttribute('name') ?? '';
        const visible = (attrEl.getAttribute('visible') ?? 'true') !== 'false';

        const scopes: EntityScope[] = [];
        const scopesEl = childElements(attrEl, 'Scopes')[0] as XmlElement | undefined;
        if (scopesEl) {
            for (const tag of SCOPE_TAGS) {
                if (childElements(scopesEl as XmlElement, tag).length > 0) {
                    scopes.push(tag);
                }
            }
        }

        const typeEl = childElements(attrEl, 'Type')[0];
        let type: EnumerationType | StringType = { kind: 'string' };
        if (typeEl) {
            const enumEl = childElements(typeEl, 'Enumeration')[0];
            if (enumEl) {
                const entries = childElements(enumEl, 'Entry').map(e => e.getAttribute('value') ?? '');
                type = {
                    kind: 'enumeration',
                    defaultValue: enumEl.getAttribute('defaultValue') ?? (entries[0] ?? ''),
                    entries,
                };
            } else {
                const strEl = childElements(typeEl, 'String')[0];
                if (strEl) {
                    type = {
                        kind: 'string',
                        defaultValue: strEl.getAttribute('defaultValue') ?? undefined,
                        validator: strEl.getAttribute('validator') ?? undefined,
                    };
                }
            }
        }

        attrs.push({ label, name, visible, scopes, type });
    }

    return { attrs };
}

export const EMPTY_SCHEMA: AttributeSchema = { attrs: [] };
