import { DOMParser, Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import {
    DvConnectionModel,
    DvDeviceModel,
    DvFunctionModel,
    DvMessageModel,
    DvModel,
    DvNodeModel,
    DvPartitionModel,
    PropertyModel,
} from '../model/types';

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

function parseProperties(el: XmlElement): PropertyModel[] {
    return childElements(el, 'Property').map(property => ({
        name: attr(property, 'name'),
        value: attr(property, 'value'),
    }));
}

const KNOWN_DV_ATTRS = new Set(['version', 'UiFile', 'creatorHash', 'modifierHash']);
const KNOWN_NODE_ATTRS = new Set(['id', 'name', 'type', 'node_label', 'namespace']);
const KNOWN_PARTITION_ATTRS = new Set(['id', 'name']);
const KNOWN_FUNCTION_ATTRS = new Set(['id', 'name', 'path']);
const KNOWN_DEVICE_ATTRS = new Set([
    'id', 'name', 'requires_bus_access', 'packetizer', 'config', 'port', 'asn1file', 'asn1type', 'asn1module',
    'impl_extends', 'extends', 'namespace', 'bus_namespace',
]);
const KNOWN_CONNECTION_ATTRS = new Set(['id', 'name', 'from_node', 'from_port', 'to_bus', 'to_node', 'to_port']);
const KNOWN_MESSAGE_ATTRS = new Set(['id', 'name', 'from_function', 'from_interface', 'to_function', 'to_interface']);

function parseFunction(el: XmlElement): DvFunctionModel {
    return {
        id: attr(el, 'id') || attr(el, 'name'),
        name: attr(el, 'name'),
        path: attr(el, 'path'),
        properties: parseProperties(el),
        extraAttrs: unknownAttrs(el, KNOWN_FUNCTION_ATTRS),
    };
}

function parsePartition(el: XmlElement | undefined): DvPartitionModel {
    if (!el) {
        return {
            id: '',
            name: '',
            functions: [],
            properties: [],
            extraAttrs: {},
        };
    }

    return {
        id: attr(el, 'id') || attr(el, 'name'),
        name: attr(el, 'name'),
        functions: childElements(el, 'Function').map(parseFunction),
        properties: parseProperties(el),
        extraAttrs: unknownAttrs(el, KNOWN_PARTITION_ATTRS),
    };
}

function parseDevice(el: XmlElement): DvDeviceModel {
    return {
        id: attr(el, 'id') || attr(el, 'name'),
        name: attr(el, 'name'),
        port: attr(el, 'port'),
        requiresBusAccess: attr(el, 'requires_bus_access'),
        packetizer: attr(el, 'packetizer'),
        config: attr(el, 'config'),
        asn1file: attr(el, 'asn1file'),
        asn1type: attr(el, 'asn1type'),
        asn1module: attr(el, 'asn1module'),
        implExtends: attr(el, 'impl_extends'),
        extends: attr(el, 'extends'),
        namespace: attr(el, 'namespace'),
        busNamespace: attr(el, 'bus_namespace'),
        properties: parseProperties(el),
        extraAttrs: unknownAttrs(el, KNOWN_DEVICE_ATTRS),
        attrOrder: Array.from({ length: el.attributes.length }, (_, index) => el.attributes[index].name),
    };
}

function parseNode(el: XmlElement): DvNodeModel {
    return {
        id: attr(el, 'id') || attr(el, 'name'),
        name: attr(el, 'name'),
        type: attr(el, 'type'),
        nodeLabel: attr(el, 'node_label'),
        namespace: attr(el, 'namespace'),
        partition: parsePartition(childElements(el, 'Partition')[0]),
        devices: childElements(el, 'Device').map(parseDevice),
        properties: parseProperties(el),
        extraAttrs: unknownAttrs(el, KNOWN_NODE_ATTRS),
    };
}

function parseMessage(el: XmlElement): DvMessageModel {
    return {
        id: attr(el, 'id') || attr(el, 'name'),
        name: attr(el, 'name'),
        fromFunction: attr(el, 'from_function'),
        fromInterface: attr(el, 'from_interface'),
        toFunction: attr(el, 'to_function'),
        toInterface: attr(el, 'to_interface'),
        properties: parseProperties(el),
        extraAttrs: unknownAttrs(el, KNOWN_MESSAGE_ATTRS),
    };
}

function parseConnection(el: XmlElement): DvConnectionModel {
    return {
        id: attr(el, 'id') || attr(el, 'name'),
        name: attr(el, 'name'),
        fromNode: attr(el, 'from_node'),
        fromPort: attr(el, 'from_port'),
        toBus: attr(el, 'to_bus'),
        toNode: attr(el, 'to_node'),
        toPort: attr(el, 'to_port'),
        messages: childElements(el, 'Message').map(parseMessage),
        properties: parseProperties(el),
        extraAttrs: unknownAttrs(el, KNOWN_CONNECTION_ATTRS),
    };
}

export function parseDvXml(xml: string): DvModel {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) {
        throw new Error('Invalid XML: no root element');
    }

    return {
        version: attr(root, 'version'),
        uiFile: attr(root, 'UiFile'),
        creatorHash: attr(root, 'creatorHash'),
        modifierHash: attr(root, 'modifierHash'),
        nodes: childElements(root, 'Node').map(parseNode),
        connections: childElements(root, 'Connection').map(parseConnection),
        unknownXmlAttrs: unknownAttrs(root, KNOWN_DV_ATTRS),
    };
}