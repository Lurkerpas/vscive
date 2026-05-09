import React, { useCallback } from 'react';
import { FunctionModel, InterfaceModel, InterfaceKind, AttributeSchema } from '../../../src/model/types';

type SelectedEntity = FunctionModel | InterfaceModel | null;

interface Props {
    selected: SelectedEntity;
    schema: AttributeSchema;
    onUpdateFunction: (id: string, patch: { name?: string; language?: string }) => void;
    onUpdateInterface: (id: string, patch: { name?: string; kind?: InterfaceKind }) => void;
}

function isInterface(e: SelectedEntity): e is InterfaceModel {
    return e !== null && 'kind' in e;
}

const PANEL_STYLE: React.CSSProperties = {
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
};

const ROW: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '4px 0',
    borderBottom: '1px solid #313244',
};

const LABEL: React.CSSProperties = { color: '#a6adc8', fontSize: 11 };
const INPUT: React.CSSProperties = {
    background: '#1e1e2e',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: 3,
    padding: '2px 4px',
    fontSize: 11,
    fontFamily: 'monospace',
    width: '100%',
    boxSizing: 'border-box',
};
const SELECT: React.CSSProperties = { ...INPUT, cursor: 'pointer' };
const STATIC: React.CSSProperties = { color: '#cdd6f4', fontSize: 11 };

function Row({ label, value }: { label: string; value: string | boolean }) {
    return (
        <div style={ROW}>
            <span style={LABEL}>{label}</span>
            <span style={STATIC}>{String(value)}</span>
        </div>
    );
}

const LANGUAGES = ['C', 'Ada', 'C_Sharp', 'Blackbox_C', 'Blackbox_Device', 'SDL', 'Simulink', 'VHDL', 'MicroPython', 'RTDS', 'Taste_Dataview', 'Pohic', 'CPP', 'System_C', 'Lustre', 'SCADE'];
const KINDS: InterfaceKind[] = ['Sporadic', 'Cyclic', 'Protected', 'Unprotected'];

export function AttributePanel({ selected, schema, onUpdateFunction, onUpdateInterface }: Props) {
    const handleFnBlur = useCallback((field: 'name' | 'language', value: string) => {
        if (selected && !isInterface(selected)) {
            onUpdateFunction(selected.id, { [field]: value });
        }
    }, [selected, onUpdateFunction]);

    const handleIfaceBlur = useCallback((field: 'name', value: string) => {
        if (selected && isInterface(selected)) {
            onUpdateInterface(selected.id, { [field]: value });
        }
    }, [selected, onUpdateInterface]);

    const handleIfaceKindChange = useCallback((kind: InterfaceKind) => {
        if (selected && isInterface(selected)) {
            onUpdateInterface(selected.id, { kind });
        }
    }, [selected, onUpdateInterface]);

    if (!selected) {
        return <div style={{ ...PANEL_STYLE, display: 'none' }} />;
    }

    if (isInterface(selected)) {
        const iface = selected;
        const schemaAttrs = schema.attrs.filter(a =>
            a.scopes.includes(iface.type === 'provided' ? 'Provided_Interface' : 'Required_Interface')
            || a.scopes.includes(iface.type === 'provided' ? 'ProvidedInterface' : 'RequiredInterface'),
        );
        return (
            <div style={PANEL_STYLE}>
                <div style={{ fontWeight: 'bold', color: '#cba6f7', marginBottom: 8 }}>
                    Interface
                </div>

                <div style={ROW}>
                    <span style={LABEL}>Name</span>
                    <input
                        style={INPUT}
                        defaultValue={iface.name}
                        key={iface.id + ':name'}
                        onBlur={e => handleIfaceBlur('name', e.target.value)}
                    />
                </div>

                <Row label="Type" value={iface.type} />

                <div style={ROW}>
                    <span style={LABEL}>Kind</span>
                    <select
                        style={SELECT}
                        value={iface.kind}
                        onChange={e => handleIfaceKindChange(e.target.value as InterfaceKind)}
                    >
                        {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                </div>

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
        <div style={PANEL_STYLE}>
            <div style={{ fontWeight: 'bold', color: '#cba6f7', marginBottom: 8 }}>
                Function
            </div>

            <div style={ROW}>
                <span style={LABEL}>Name</span>
                <input
                    style={INPUT}
                    defaultValue={fn.name}
                    key={fn.id + ':name'}
                    onBlur={e => handleFnBlur('name', e.target.value)}
                />
            </div>

            <div style={ROW}>
                <span style={LABEL}>Language</span>
                <select
                    style={SELECT}
                    value={fn.language}
                    onChange={e => handleFnBlur('language', e.target.value)}
                >
                    {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
            </div>

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

