import {
    IvModel, FunctionModel, InterfaceModel, ConnectionModel, ParameterModel,
} from '../model/types';

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function toAttrStr(attrs: Record<string, string>): string {
    return Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
}

function serializeParam(p: ParameterModel, indent: string): string {
    const tag = p.direction === 'input' ? 'Input_Parameter' : 'Output_Parameter';
    return `${indent}<${tag} name="${esc(p.name)}" type="${esc(p.type)}" encoding="${p.encoding}"/>`;
}

function serializeInterface(iface: InterfaceModel, indent: string): string {
    const tag = iface.type === 'provided' ? 'Provided_Interface' : 'Required_Interface';
    const attrs: Record<string, string> = {
        id: iface.id,
        name: iface.name,
        kind: iface.kind,
        ...iface.extraAttrs,
    };

    const inputs = iface.parameters.filter(p => p.direction === 'input');
    const outputs = iface.parameters.filter(p => p.direction === 'output');
    const children: string[] = [
        ...inputs.map(p => serializeParam(p, `${indent}  `)),
        ...outputs.map(p => serializeParam(p, `${indent}  `)),
    ];
    if (iface.inheritPI) {
        children.push(`${indent}  <Property name="Taste::InheritPI" value="true"/>`);
    }
    if (iface.autonamed) {
        children.push(`${indent}  <Property name="Taste::Autonamed" value="true"/>`);
    }
    for (const prop of iface.properties) {
        children.push(`${indent}  <Property name="${esc(prop.name)}" value="${esc(prop.value)}"/>`);
    }

    if (children.length === 0) {
        return `${indent}<${tag}${toAttrStr(attrs)}/>`;
    }
    return [`${indent}<${tag}${toAttrStr(attrs)}>`, ...children, `${indent}</${tag}>`].join('\n');
}

function serializeFunction(fn: FunctionModel, indent: string): string {
    const knownAttrs: Record<string, string> = {
        id: fn.id,
        name: fn.name,
        language: fn.language,
        is_type: fn.isType ? 'YES' : 'NO',
        fixed_system_element: fn.fixedSystemElement ? 'YES' : 'NO',
        required_system_element: fn.requiredSystemElement ? 'YES' : 'NO',
    };
    if (fn.defaultImplementation) {
        knownAttrs.default_implementation = fn.defaultImplementation;
    }
    const attrs = { ...knownAttrs, ...fn.extraAttrs };

    const lines: string[] = [`${indent}<Function${toAttrStr(attrs)}>`];
    for (const iface of fn.providedInterfaces) {
        lines.push(serializeInterface(iface, `${indent}  `));
    }
    for (const iface of fn.requiredInterfaces) {
        lines.push(serializeInterface(iface, `${indent}  `));
    }
    for (const nested of fn.nestedFunctions) {
        lines.push(serializeFunction(nested, `${indent}  `));
    }
    if (fn.implementations.length > 0) {
        lines.push(`${indent}  <Implementations>`);
        for (const impl of fn.implementations) {
            lines.push(`${indent}    <Implementation name="${esc(impl.name)}" language="${esc(impl.language)}"/>`);
        }
        lines.push(`${indent}  </Implementations>`);
    }
    for (const prop of fn.properties) {
        lines.push(`${indent}  <Property name="${esc(prop.name)}" value="${esc(prop.value)}"/>`);
    }
    lines.push(`${indent}</Function>`);
    return lines.join('\n');
}

function serializeConnection(conn: ConnectionModel, indent: string): string {
    const attrs: Record<string, string> = { id: conn.id, name: conn.name, ...conn.extraAttrs };
    const lines: string[] = [`${indent}<Connection${toAttrStr(attrs)}>`];
    lines.push(`${indent}  <Source iface_id="${esc(conn.sourceIfaceId)}" func_name="${esc(conn.sourceFuncName)}" ri_name="${esc(conn.sourceRiName)}"/>`);
    lines.push(`${indent}  <Target iface_id="${esc(conn.targetIfaceId)}" func_name="${esc(conn.targetFuncName)}" pi_name="${esc(conn.targetPiName)}"/>`);
    for (const prop of conn.properties) {
        lines.push(`${indent}  <Property name="${esc(prop.name)}" value="${esc(prop.value)}"/>`);
    }
    lines.push(`${indent}</Connection>`);
    return lines.join('\n');
}

export function serializeIvXml(iv: IvModel): string {
    const rootAttrs: Record<string, string> = {
        version: iv.version,
        asn1file: iv.asn1file,
        UiFile: iv.uiFile,
        modifierHash: iv.modifierHash,
        ...iv.unknownXmlAttrs,
    };
    const lines: string[] = [
        '<?xml version="1.0"?>',
        `<InterfaceView${toAttrStr(rootAttrs)}>`,
    ];
    for (const fn of iv.functions) {
        lines.push(serializeFunction(fn, '  '));
    }
    for (const conn of iv.connections) {
        lines.push(serializeConnection(conn, '  '));
    }
    for (const layer of iv.layers) {
        lines.push(`  <Layer name="${esc(layer.name)}" is_visible="${layer.isVisible}"/>`);
    }
    lines.push('</InterfaceView>');
    return lines.join('\n');
}
