import React from 'react';
import { FunctionModel, InterfaceModel, AttributeSchema } from '../../../src/model/types';

type SelectedEntity = FunctionModel | InterfaceModel | null;

interface Props {
    selected: SelectedEntity;
    schema: AttributeSchema;
}

function isInterface(e: SelectedEntity): e is InterfaceModel {
    return e !== null && 'kind' in e;
}

function Row({ label, value }: { label: string; value: string | boolean }) {
    return (
        <div style={{ display: 'flex', gap: 6, padding: '2px 0', borderBottom: '1px solid #313244' }}>
            <span style={{ color: '#a6adc8', minWidth: 110, fontSize: 11 }}>{label}</span>
            <span style={{ color: '#cdd6f4', fontSize: 11, wordBreak: 'break-all' }}>
                {String(value)}
            </span>
        </div>
    );
}

export function AttributePanel({ selected, schema }: Props) {
    const panelStyle: React.CSSProperties = {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 260,
        background: '#181825',
        borderLeft: '1px solid #313244',
        padding: 10,
        overflowY: 'auto',
        fontFamily: 'monospace',
        zIndex: 10,
        display: selected ? 'block' : 'none',
    };

    if (!selected) { return <div style={panelStyle} />; }

    if (isInterface(selected)) {
        const iface = selected;
        const schemaAttrs = schema.attrs.filter(a =>
            a.scopes.includes(iface.type === 'provided' ? 'Provided_Interface' : 'Required_Interface')
            || a.scopes.includes(iface.type === 'provided' ? 'ProvidedInterface' : 'RequiredInterface')
        );
        return (
            <div style={panelStyle}>
                <div style={{ fontWeight: 'bold', color: '#cba6f7', marginBottom: 8 }}>
                    Interface: {iface.name}
                </div>
                <Row label="Type" value={iface.type} />
                <Row label="Kind" value={iface.kind} />
                <Row label="InheritPI" value={iface.inheritPI} />
                <Row label="Autonamed" value={iface.autonamed} />

                {iface.parameters.length > 0 && (
                    <>
                        <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                            Parameters
                        </div>
                        {iface.parameters.map((p, i) => (
                            <div key={i} style={{ paddingLeft: 8, marginBottom: 4 }}>
                                <Row label="name" value={p.name} />
                                <Row label="type" value={p.type} />
                                <Row label="direction" value={p.direction} />
                                <Row label="encoding" value={p.encoding} />
                            </div>
                        ))}
                    </>
                )}

                {schemaAttrs.length > 0 && (
                    <>
                        <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                            Extra Attributes
                        </div>
                        {schemaAttrs.map((a, i) => (
                            <Row key={i} label={a.label} value={iface.extraAttrs[a.name] ?? ''} />
                        ))}
                    </>
                )}

                {iface.properties.length > 0 && (
                    <>
                        <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                            Properties
                        </div>
                        {iface.properties.map((p, i) => (
                            <Row key={i} label={p.name} value={p.value} />
                        ))}
                    </>
                )}
            </div>
        );
    }

    // Function
    const fn = selected as FunctionModel;
    const schemaAttrs = schema.attrs.filter(a => a.scopes.includes('Function'));
    return (
        <div style={panelStyle}>
            <div style={{ fontWeight: 'bold', color: '#cba6f7', marginBottom: 8 }}>
                Function: {fn.name}
            </div>
            <Row label="Language" value={fn.language} />
            <Row label="Impl." value={fn.defaultImplementation} />
            <Row label="Is Type" value={fn.isType} />
            <Row label="Fixed" value={fn.fixedSystemElement} />

            {fn.implementations.length > 0 && (
                <>
                    <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                        Implementations
                    </div>
                    {fn.implementations.map((imp, i) => (
                        <Row key={i} label={imp.name} value={imp.language} />
                    ))}
                </>
            )}

            {schemaAttrs.length > 0 && (
                <>
                    <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                        Extra Attributes
                    </div>
                    {schemaAttrs.map((a, i) => (
                        <Row key={i} label={a.label} value={fn.extraAttrs[a.name] ?? ''} />
                    ))}
                </>
            )}

            {fn.properties.length > 0 && (
                <>
                    <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                        Properties
                    </div>
                    {fn.properties.map((p, i) => (
                        <Row key={i} label={p.name} value={p.value} />
                    ))}
                </>
            )}
        </div>
    );
}
