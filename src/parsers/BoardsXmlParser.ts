import { DOMParser, Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import { BoardModel, BoardPortModel, BoardsFileModel } from '../model/types';

function childElements(el: XmlElement | XmlDocument, tagName: string): XmlElement[] {
    const out: XmlElement[] = [];
    const nodes = el.childNodes;
    for (let index = 0; index < nodes.length; index++) {
        const child = nodes[index];
        if (child.nodeType === 1 && (child as XmlElement).tagName === tagName) {
            out.push(child as XmlElement);
        }
    }
    return out;
}

function attr(el: XmlElement, name: string, fallback = ''): string {
    return el.getAttribute(name) ?? fallback;
}

function unknownAttrs(el: XmlElement, known: Set<string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (let index = 0; index < el.attributes.length; index++) {
        const attribute = el.attributes[index];
        if (!known.has(attribute.name)) {
            result[attribute.name] = attribute.value;
        }
    }
    return result;
}

const KNOWN_BOARD_ATTRS = new Set(['name', 'type', 'namespace']);
const KNOWN_PORT_ATTRS = new Set([
    'name', 'namespace', 'bus_namespace', 'extends', 'impl_extends', 'asn1file', 'asn1module', 'asn1type', 'requiresBusAccess',
    'requires_bus_access', 'config', 'packetizer',
]);

function parsePort(el: XmlElement): BoardPortModel {
    return {
        name: attr(el, 'name'),
        namespace: attr(el, 'namespace'),
        busNamespace: attr(el, 'bus_namespace'),
        extends: attr(el, 'extends'),
        implExtends: attr(el, 'impl_extends'),
        asn1file: attr(el, 'asn1file'),
        asn1module: attr(el, 'asn1module'),
        asn1type: attr(el, 'asn1type'),
        requiresBusAccess: attr(el, 'requiresBusAccess') || attr(el, 'requires_bus_access'),
        config: attr(el, 'config'),
        packetizer: attr(el, 'packetizer'),
        extraAttrs: unknownAttrs(el, KNOWN_PORT_ATTRS),
    };
}

function parseBoard(el: XmlElement): BoardModel {
    return {
        name: attr(el, 'name'),
        type: attr(el, 'type'),
        namespace: attr(el, 'namespace'),
        ports: childElements(el, 'Port').map(parsePort),
        extraAttrs: unknownAttrs(el, KNOWN_BOARD_ATTRS),
    };
}

export function parseBoardsXml(xml: string): BoardsFileModel {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) {
        return { boards: [] };
    }

    return {
        boards: childElements(root, 'Board').map(parseBoard),
    };
}