import { DOMParser, Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import {
    IvModel, FunctionModel, InterfaceModel, ConnectionModel,
    LayerModel, PropertyModel, ParameterModel, ImplementationModel, CommentModel, ContextParameterModel,
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
// Only attrs that are explicitly parsed into typed model fields go here;
// everything else falls through to extraAttrs for lossless round-trip.
const KNOWN_FUNC_ATTRS = new Set([
    'id', 'name', 'language', 'default_implementation', 'is_type',
    'fixed_system_element', 'required_system_element',
]);
const KNOWN_IFACE_ATTRS = new Set(['id', 'name', 'kind']);

function parseProperties(el: XmlElement): { properties: PropertyModel[]; inheritPI: boolean; inheritPIExplicit: boolean; autonamed: boolean; autonamedExplicit: boolean } {
    const properties: PropertyModel[] = [];
    let inheritPI = false;
    let inheritPIExplicit = false;
    let autonamed = false;
    let autonamedExplicit = false;
    for (const p of childElements(el, 'Property')) {
        const name = attr(p, 'name');
        const value = attr(p, 'value');
        if (name === 'Taste::InheritPI') {
            inheritPI = value === 'true';
            inheritPIExplicit = true;
            continue;
        }
        if (name === 'Taste::Autonamed') {
            autonamed = value === 'true';
            autonamedExplicit = true;
            continue;
        }
        properties.push({ name, value });
    }
    return { properties, inheritPI, inheritPIExplicit, autonamed, autonamedExplicit };
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
    const { properties, inheritPI, inheritPIExplicit, autonamed, autonamedExplicit } = parseProperties(el);
    const parameters: ParameterModel[] = [
        ...parseParams(el, 'input', 'Input_Parameter'),
        ...parseParams(el, 'output', 'Output_Parameter'),
    ];
    return {
        id: attr(el, 'id') || attr(el, 'name'),
        name: attr(el, 'name'),
        type,
        kind: attr(el, 'kind', 'Sporadic') as InterfaceModel['kind'],
        parameters,
        inheritPI,
        inheritPIExplicit,
        autonamed,
        autonamedExplicit,
        properties,
        extraAttrs: unknownAttrs(el, KNOWN_IFACE_ATTRS),
    };
}

function parseFunction(el: XmlElement): FunctionModel {
    const { properties } = parseProperties(el);
    const impls: ImplementationModel[] = childElements(el, 'Implementations')
        .flatMap(impl => childElements(impl, 'Implementation'))
        .map(i => ({ name: attr(i, 'name'), language: attr(i, 'language') }));
    const contextParameters: ContextParameterModel[] = childElements(el, 'ContextParameter').map(param => ({
        name: attr(param, 'name'),
        type: attr(param, 'type'),
        value: attr(param, 'value'),
        extraAttrs: unknownAttrs(param, new Set(['name', 'type', 'value'])),
    }));

    return {
        id: attr(el, 'id') || attr(el, 'name'),
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
        contextParameters,
        properties,
        extraAttrs: unknownAttrs(el, KNOWN_FUNC_ATTRS),
    };
}

export function parseIvXml(xml: string): IvModel {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) { throw new Error('Invalid XML: no root element'); }

    // Parse functions first so legacy connections can resolve iface IDs from them.
    const functions = childElements(root, 'Function').map(parseFunction);

    function findFunctionByName(fns: FunctionModel[], name: string): FunctionModel | undefined {
        for (const fn of fns) {
            if (fn.name === name) { return fn; }
            const found = findFunctionByName(fn.nestedFunctions, name);
            if (found) { return found; }
        }
        return undefined;
    }

    function resolveIfaceId(funcName: string, ifaceName: string): string {
        const fn = findFunctionByName(functions, funcName);
        if (!fn) { return ''; }
        const iface = [...fn.providedInterfaces, ...fn.requiredInterfaces].find(i => i.name === ifaceName);
        return iface?.id ?? '';
    }

    // Collect all Connection elements from root AND from any nested Function elements
    // (e.g. SpaceCreator stores ASW's 500+ internal connections inside the ASW Function element)
    function collectConnectionElements(el: XmlElement | XmlDocument): XmlElement[] {
        const out: XmlElement[] = [];
        for (const c of childElements(el as XmlElement, 'Connection')) { out.push(c); }
        for (const fn of childElements(el as XmlElement, 'Function')) {
            out.push(...collectConnectionElements(fn));
        }
        return out;
    }

    const connections: ConnectionModel[] = collectConnectionElements(root).map(c => {
        const src = childElements(c, 'Source')[0] as XmlElement | undefined;
        const tgt = childElements(c, 'Target')[0] as XmlElement | undefined;
        const { properties } = parseProperties(c);

        const sourceFuncName = src ? attr(src, 'func_name') : '';
        const sourceNameAttr: 'ri_name' | 'pi_name' = src?.hasAttribute('pi_name') ? 'pi_name' : 'ri_name';
        const sourceRiName   = src ? (attr(src, 'ri_name') || attr(src, 'pi_name') || '') : '';
        const targetFuncName = tgt ? attr(tgt, 'func_name') : '';
        const targetNameAttr: 'ri_name' | 'pi_name' = tgt?.hasAttribute('ri_name') ? 'ri_name' : 'pi_name';
        const targetPiName   = tgt ? (attr(tgt, 'pi_name') || attr(tgt, 'ri_name') || '') : '';

        const sourceIfaceIdExplicit = src ? src.hasAttribute('iface_id') : false;
        const targetIfaceIdExplicit = tgt ? tgt.hasAttribute('iface_id') : false;
        let sourceIfaceId = src ? attr(src, 'iface_id') : '';
        let targetIfaceId = tgt ? attr(tgt, 'iface_id') : '';

        // Legacy format: no iface_id — resolve by func_name + ri/pi_name
        if (!sourceIfaceId && sourceFuncName && sourceRiName) {
            sourceIfaceId = resolveIfaceId(sourceFuncName, sourceRiName);
        }
        if (!targetIfaceId && targetFuncName && targetPiName) {
            targetIfaceId = resolveIfaceId(targetFuncName, targetPiName);
        }

        // Legacy format: no id or name — generate stable ones from endpoint names
        const fallbackId   = `${sourceFuncName}_${sourceRiName}__${targetFuncName}_${targetPiName}`;
        const nameExplicit = c.hasAttribute('name');
        const fallbackName = sourceRiName || targetPiName;

        return {
            id:   attr(c, 'id')   || fallbackId,
            name: attr(c, 'name') || fallbackName,
            nameExplicit,
            sourceIfaceId,
            sourceIfaceIdExplicit,
            sourceFuncName,
            sourceRiName,
            sourceNameAttr,
            targetIfaceId,
            targetIfaceIdExplicit,
            targetFuncName,
            targetPiName,
            targetNameAttr,
            properties,
            extraAttrs: unknownAttrs(c, new Set(['id', 'name'])),
        };
    });

    const comments: CommentModel[] = childElements(root, 'Comment').map(comment => ({
        id: attr(comment, 'id'),
        name: attr(comment, 'name'),
        requiredSystemElement: boolAttr(comment, 'required_system_element'),
        extraAttrs: unknownAttrs(comment, new Set(['id', 'name', 'required_system_element'])),
    }));

    const layers: LayerModel[] = childElements(root, 'Layer').map(l => ({
        name: attr(l, 'name'),
        isVisible: attr(l, 'is_visible', 'true') === 'true',
    }));

    return {
        version: attr(root, 'version'),
        asn1file: attr(root, 'asn1file'),
        uiFile: attr(root, 'UiFile'),
        modifierHash: attr(root, 'modifierHash'),
        functions,
        connections,
        comments,
        layers,
        unknownXmlAttrs: unknownAttrs(root, KNOWN_IV_ATTRS),
    };
}
