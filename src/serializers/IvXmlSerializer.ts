import {
    IvModel, FunctionModel, InterfaceModel, ConnectionModel, ParameterModel, CommentModel, ContextParameterModel,
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
    if (iface.inheritPIExplicit ?? iface.inheritPI) {
        children.push(`${indent}  <Property name="Taste::InheritPI" value="${iface.inheritPI ? 'true' : 'false'}"/>`);
    }
    if (iface.autonamedExplicit ?? iface.autonamed) {
        children.push(`${indent}  <Property name="Taste::Autonamed" value="${iface.autonamed ? 'true' : 'false'}"/>`);
    }
    for (const prop of iface.properties) {
        children.push(`${indent}  <Property name="${esc(prop.name)}" value="${esc(prop.value)}"/>`);
    }
    return [`${indent}<${tag}${toAttrStr(attrs)}>`, ...children, `${indent}</${tag}>`].join('\n');
}

function findIfaceHostPath(
    functions: FunctionModel[],
    ifaceId: string,
    path: FunctionModel[] = [],
): FunctionModel[] | undefined {
    for (const fn of functions) {
        const nextPath = [...path, fn];
        if ([...fn.providedInterfaces, ...fn.requiredInterfaces].some(iface => iface.id === ifaceId)) {
            return nextPath;
        }
        const found = findIfaceHostPath(fn.nestedFunctions, ifaceId, nextPath);
        if (found) { return found; }
    }
    return undefined;
}

function inferConnectionOwnerId(iv: IvModel, conn: ConnectionModel): string | undefined {
    const srcPath = findIfaceHostPath(iv.functions, conn.sourceIfaceId);
    const tgtPath = findIfaceHostPath(iv.functions, conn.targetIfaceId);
    if (!srcPath || !tgtPath) { return undefined; }

    let ownerId: string | undefined;
    const maxDepth = Math.min(srcPath.length, tgtPath.length);
    for (let index = 0; index < maxDepth; index++) {
        if (srcPath[index].id !== tgtPath[index].id) { break; }
        ownerId = srcPath[index].id;
    }
    return ownerId;
}

function serializeFunction(
    fn: FunctionModel,
    indent: string,
    connectionsByOwner: Map<string | undefined, ConnectionModel[]>,
): string {
    const knownAttrs: Record<string, string> = {
        id: fn.id,
        name: fn.name,
        is_type: fn.isType ? 'YES' : 'NO',
        language: fn.language,
    };
    if (fn.defaultImplementation) {
        knownAttrs.default_implementation = fn.defaultImplementation;
    }
    Object.assign(knownAttrs, {
        fixed_system_element: fn.fixedSystemElement ? 'YES' : 'NO',
        required_system_element: fn.requiredSystemElement ? 'YES' : 'NO',
    });
    const attrs = { ...knownAttrs, ...fn.extraAttrs };

    const lines: string[] = [`${indent}<Function${toAttrStr(attrs)}>`];
    for (const prop of fn.properties) {
        lines.push(`${indent}  <Property name="${esc(prop.name)}" value="${esc(prop.value)}"/>`);
    }
    for (const contextParameter of fn.contextParameters ?? []) {
        lines.push(serializeContextParameter(contextParameter, `${indent}  `));
    }
    for (const iface of fn.providedInterfaces) {
        lines.push(serializeInterface(iface, `${indent}  `));
    }
    for (const iface of fn.requiredInterfaces) {
        lines.push(serializeInterface(iface, `${indent}  `));
    }
    for (const nested of fn.nestedFunctions) {
        lines.push(serializeFunction(nested, `${indent}  `, connectionsByOwner));
    }
    for (const conn of connectionsByOwner.get(fn.id) ?? []) {
        lines.push(serializeConnection(conn, `${indent}  `));
    }
    if (fn.implementations.length > 0) {
        lines.push(`${indent}  <Implementations>`);
        for (const impl of fn.implementations) {
            lines.push(`${indent}    <Implementation name="${esc(impl.name)}" language="${esc(impl.language)}"/>`);
        }
        lines.push(`${indent}  </Implementations>`);
    }
    lines.push(`${indent}</Function>`);
    return lines.join('\n');
}

function serializeConnection(conn: ConnectionModel, indent: string): string {
    const attrs: Record<string, string> = { id: conn.id };
    if (conn.nameExplicit ?? conn.name.length > 0) {
        attrs.name = conn.name;
    }
    Object.assign(attrs, conn.extraAttrs);
    const lines: string[] = [`${indent}<Connection${toAttrStr(attrs)}>`];
    const sourceAttrs: string[] = [];
    if (conn.sourceIfaceIdExplicit ?? conn.sourceIfaceId.length > 0) {
        sourceAttrs.push(`iface_id="${esc(conn.sourceIfaceId)}"`);
    }
    sourceAttrs.push(`func_name="${esc(conn.sourceFuncName)}"`);
    sourceAttrs.push(`${conn.sourceNameAttr ?? 'ri_name'}="${esc(conn.sourceRiName)}"`);
    lines.push(`${indent}  <Source ${sourceAttrs.join(' ')}/>`);

    const targetAttrs: string[] = [];
    if (conn.targetIfaceIdExplicit ?? conn.targetIfaceId.length > 0) {
        targetAttrs.push(`iface_id="${esc(conn.targetIfaceId)}"`);
    }
    targetAttrs.push(`func_name="${esc(conn.targetFuncName)}"`);
    targetAttrs.push(`${conn.targetNameAttr ?? 'pi_name'}="${esc(conn.targetPiName)}"`);
    lines.push(`${indent}  <Target ${targetAttrs.join(' ')}/>`);
    for (const prop of conn.properties) {
        lines.push(`${indent}  <Property name="${esc(prop.name)}" value="${esc(prop.value)}"/>`);
    }
    lines.push(`${indent}</Connection>`);
    return lines.join('\n');
}

function serializeContextParameter(contextParameter: ContextParameterModel, indent: string): string {
    const attrs: Record<string, string> = {
        name: contextParameter.name,
        type: contextParameter.type,
        value: contextParameter.value,
        ...contextParameter.extraAttrs,
    };
    return `${indent}<ContextParameter${toAttrStr(attrs)}/>`;
}

function serializeComment(comment: CommentModel, indent: string): string {
    const attrs: Record<string, string> = {
        id: comment.id,
        name: comment.name,
        required_system_element: comment.requiredSystemElement ? 'YES' : 'NO',
        ...comment.extraAttrs,
    };
    return `${indent}<Comment${toAttrStr(attrs)}></Comment>`;
}

export function serializeIvXml(iv: IvModel): string {
    const connectionsByOwner = new Map<string | undefined, ConnectionModel[]>();
    for (const conn of iv.connections) {
        const ownerId = inferConnectionOwnerId(iv, conn);
        const bucket = connectionsByOwner.get(ownerId) ?? [];
        bucket.push(conn);
        connectionsByOwner.set(ownerId, bucket);
    }

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
        lines.push(serializeFunction(fn, '  ', connectionsByOwner));
    }
    for (const conn of connectionsByOwner.get(undefined) ?? []) {
        lines.push(serializeConnection(conn, '  '));
    }
    for (const comment of iv.comments ?? []) {
        lines.push(serializeComment(comment, '  '));
    }
    for (const layer of iv.layers) {
        lines.push(`  <Layer name="${esc(layer.name)}" is_visible="${layer.isVisible}"/>`);
    }
    lines.push('</InterfaceView>');
    return lines.join('\n');
}
