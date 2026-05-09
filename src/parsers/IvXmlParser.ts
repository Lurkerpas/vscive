import { DOMParser, Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import {
    IvModel, FunctionModel, InterfaceModel, ConnectionModel,
    LayerModel, PropertyModel, ParameterModel, ImplementationModel,
    ParameterEncoding,
} from '../model/types';

function attrs(el: XmlElement): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i];
        result[a.name] = a.value;
    }
    return result;
}

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

function attr(el: XmlElement, name: string, fallback = ''): string {
    return el.getAttribute(name) ?? fallback;
}

function boolAttr(el: XmlElement, name: string): boolean {
    return attr(el, name, 'NO').toUpperCase() === 'YES';
}

function unknownAttrs(el: XmlElement, known: Set<string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i];
        if (!known.has(a.name)) { result[a.name] = a.value; }
    }
    return result;
}

const KNOWN_IV_ATTRS = new Set(['version', 'asn1file', 'UiFile', 'modifierHash']);
const KNOWN_FUNC_ATTRS = new Set([
    'id', 'name', 'language', 'default_implementation', 'is_type',
    'fixed_system_element', 'required_system_element', 'startup_priority',
    'instances_min', 'instances_max',
]);
const KNOWN_IFACE_ATTRS = new Set([
    'id', 'name', 'kind', 'enable_multicast', 'layer',
    'required_system_element', 'is_simulink_interface',
    'wcet', 'miat', 'queue_size', 'priority', 'stack_size', 'period', 'dispatch_offset',
]);

function parseProperties(el: XmlElement): { properties: PropertyModel[]; inheritPI: boolean; autonamed: boolean } {
    const properties: PropertyModel[] = [];
    let inheritPI = false;
    let autonamed = false;
    for (const p of childElements(el, 'Property')) {
        const name = attr(p, 'name');
        const value = attr(p, 'value');
        if (name === 'Taste::InheritPI') { inheritPI = value === 'true'; continue; }
        if (name === 'Taste::Autonamed') { autonamed = value === 'true'; continue; }
        properties.push({ name, value });
    }
    return { properties, inheritPI, autonamed };
}

function parseParams(el: XmlElement, direction: 'input' | 'output', tag: string): ParameterModel[] {
    return childElements(el, tag).map(p => ({
        name: attr(p, 'name'),
        type: attr(p, 'type'),
        direction,
        encoding: (attr(p, 'encoding', 'NATIVE') as ParameterEncoding),
    }));
}

function parseInterface(el: XmlElement, type: 'provided' | 'required'): InterfaceModel {
    const { properties, inheritPI, autonamed } = parseProperties(el);
    const parameters: ParameterModel[] = [
        ...parseParams(el, 'input', 'Input_Parameter'),
        ...parseParams(el, 'output', 'Output_Parameter'),
    ];
    return {
        id: attr(el, 'id'),
        name: attr(el, 'name'),
        type,
        kind: attr(el, 'kind', 'Sporadic') as InterfaceModel['kind'],
        parameters,
        inheritPI,
        autonamed,
        properties,
        extraAttrs: unknownAttrs(el, KNOWN_IFACE_ATTRS),
    };
}

function parseFunction(el: XmlElement): FunctionModel {
    const { properties } = parseProperties(el);
    const impls: ImplementationModel[] = childElements(el, 'Implementations')
        .flatMap(impl => childElements(impl, 'Implementation'))
        .map(i => ({ name: attr(i, 'name'), language: attr(i, 'language') }));

    return {
        id: attr(el, 'id'),
        name: attr(el, 'name'),
        language: attr(el, 'language', ''),
        defaultImplementation: attr(el, 'default_implementation', ''),
        isType: boolAttr(el, 'is_type'),
        fixedSystemElement: boolAttr(el, 'fixed_system_element'),
        requiredSystemElement: boolAttr(el, 'required_system_element'),
        providedInterfaces: childElements(el, 'Provided_Interface').map(e => parseInterface(e, 'provided')),
        requiredInterfaces: childElements(el, 'Required_Interface').map(e => parseInterface(e, 'required')),
        nestedFunctions: childElements(el, 'Function').map(parseFunction),
        implementations: impls,
        properties,
        extraAttrs: unknownAttrs(el, KNOWN_FUNC_ATTRS),
    };
}

export function parseIvXml(xml: string): IvModel {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) { throw new Error('Invalid XML: no root element'); }

    const connections: ConnectionModel[] = childElements(root, 'Connection').map(c => {
        const src = childElements(c, 'Source')[0] as XmlElement | undefined;
        const tgt = childElements(c, 'Target')[0] as XmlElement | undefined;
        const { properties } = parseProperties(c);
        return {
            id: attr(c, 'id'),
            name: attr(c, 'name'),
            sourceIfaceId: src ? attr(src, 'iface_id') : '',
            sourceFuncName: src ? attr(src, 'func_name') : '',
            sourceRiName: src ? (attr(src, 'ri_name') || '') : '',
            targetIfaceId: tgt ? attr(tgt, 'iface_id') : '',
            targetFuncName: tgt ? attr(tgt, 'func_name') : '',
            targetPiName: tgt ? (attr(tgt, 'pi_name') || '') : '',
            properties,
            extraAttrs: unknownAttrs(c, new Set(['id', 'name', 'required_system_element'])),
        };
    });

    const layers: LayerModel[] = childElements(root, 'Layer').map(l => ({
        name: attr(l, 'name'),
        isVisible: attr(l, 'is_visible', 'true') === 'true',
    }));

    return {
        version: attr(root, 'version'),
        asn1file: attr(root, 'asn1file'),
        uiFile: attr(root, 'UiFile'),
        modifierHash: attr(root, 'modifierHash'),
        functions: childElements(root, 'Function').map(parseFunction),
        connections,
        layers,
        unknownXmlAttrs: unknownAttrs(root, KNOWN_IV_ATTRS),
    };
}
