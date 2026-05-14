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

function esc(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function toAttrStr(attrs: Record<string, string>): string {
    return Object.entries(attrs)
        .filter(([, value]) => value !== '')
        .map(([name, value]) => ` ${name}="${esc(value)}"`)
        .join('');
}

function toOrderedAttrStr(attrs: Record<string, string>, order?: string[]): string {
    if (!order || order.length === 0) {
        return toAttrStr(attrs);
    }
    const seen = new Set<string>();
    const ordered: Array<[string, string]> = [];
    for (const name of order) {
        const value = attrs[name];
        if (value !== undefined && value !== '') {
            ordered.push([name, value]);
            seen.add(name);
        }
    }
    for (const [name, value] of Object.entries(attrs)) {
        if (!seen.has(name) && value !== '') {
            ordered.push([name, value]);
        }
    }
    return ordered.map(([name, value]) => ` ${name}="${esc(value)}"`).join('');
}

function serializeProperties(properties: PropertyModel[], indent: string): string[] {
    return properties.map(property => `${indent}<Property name="${esc(property.name)}" value="${esc(property.value)}"/>`);
}

function serializeFunction(fn: DvFunctionModel, indent: string): string {
    const attrs: Record<string, string> = {
        id: fn.id,
        name: fn.name,
        path: fn.path,
        ...fn.extraAttrs,
    };
    const lines: string[] = [`${indent}<Function${toAttrStr(attrs)}>`];
    lines.push(...serializeProperties(fn.properties, `${indent}  `));
    lines.push(`${indent}</Function>`);
    return lines.join('\n');
}

function serializePartition(partition: DvPartitionModel, indent: string): string {
    const attrs: Record<string, string> = {
        id: partition.id,
        name: partition.name,
        ...partition.extraAttrs,
    };
    const lines: string[] = [`${indent}<Partition${toAttrStr(attrs)}>`];
    lines.push(...serializeProperties(partition.properties, `${indent}  `));
    for (const fn of partition.functions) {
        lines.push(serializeFunction(fn, `${indent}  `));
    }
    lines.push(`${indent}</Partition>`);
    return lines.join('\n');
}

function serializeDevice(device: DvDeviceModel, indent: string): string {
    const attrs: Record<string, string> = {
        id: device.id,
        name: device.name,
        requires_bus_access: device.requiresBusAccess,
        packetizer: device.packetizer,
        config: device.config,
        port: device.port,
        asn1file: device.asn1file,
        asn1type: device.asn1type,
        asn1module: device.asn1module,
        impl_extends: device.implExtends,
        extends: device.extends,
        namespace: device.namespace,
        bus_namespace: device.busNamespace,
        ...device.extraAttrs,
    };
    const lines: string[] = [`${indent}<Device${toOrderedAttrStr(attrs, device.attrOrder)}>`];
    lines.push(...serializeProperties(device.properties, `${indent}  `));
    lines.push(`${indent}</Device>`);
    return lines.join('\n');
}

function serializeNode(node: DvNodeModel, indent: string): string {
    const attrs: Record<string, string> = {
        id: node.id,
        name: node.name,
        type: node.type,
        node_label: node.nodeLabel,
        namespace: node.namespace,
        ...node.extraAttrs,
    };
    const lines: string[] = [`${indent}<Node${toAttrStr(attrs)}>`];
    lines.push(...serializeProperties(node.properties, `${indent}  `));
    lines.push(serializePartition(node.partition, `${indent}  `));
    for (const device of node.devices) {
        lines.push(serializeDevice(device, `${indent}  `));
    }
    lines.push(`${indent}</Node>`);
    return lines.join('\n');
}

function serializeMessage(message: DvMessageModel, indent: string): string {
    const attrs: Record<string, string> = {
        id: message.id,
        name: message.name,
        from_function: message.fromFunction,
        from_interface: message.fromInterface,
        to_function: message.toFunction,
        to_interface: message.toInterface,
        ...message.extraAttrs,
    };
    const lines: string[] = [`${indent}<Message${toAttrStr(attrs)}>`];
    lines.push(...serializeProperties(message.properties, `${indent}  `));
    lines.push(`${indent}</Message>`);
    return lines.join('\n');
}

function serializeConnection(connection: DvConnectionModel, indent: string): string {
    const attrs: Record<string, string> = {
        id: connection.id,
        name: connection.name,
        from_node: connection.fromNode,
        from_port: connection.fromPort,
        to_bus: connection.toBus,
        to_node: connection.toNode,
        to_port: connection.toPort,
        ...connection.extraAttrs,
    };
    const lines: string[] = [`${indent}<Connection${toAttrStr(attrs)}>`];
    lines.push(...serializeProperties(connection.properties, `${indent}  `));
    for (const message of connection.messages) {
        lines.push(serializeMessage(message, `${indent}  `));
    }
    lines.push(`${indent}</Connection>`);
    return lines.join('\n');
}

export function serializeDvXml(dv: DvModel): string {
    const attrs: Record<string, string> = {
        version: dv.version,
        UiFile: dv.uiFile,
        creatorHash: dv.creatorHash,
        modifierHash: dv.modifierHash,
        ...dv.unknownXmlAttrs,
    };
    const lines: string[] = [
        '<?xml version="1.0"?>',
        `<DeploymentView${toAttrStr(attrs)}>`,
    ];

    for (const node of dv.nodes) {
        lines.push(serializeNode(node, '  '));
    }
    for (const connection of dv.connections) {
        lines.push(serializeConnection(connection, '  '));
    }
    lines.push('</DeploymentView>');
    return lines.join('\n');
}