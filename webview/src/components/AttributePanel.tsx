import React, { useState } from 'react';
import {
    FunctionModel, InterfaceModel, InterfaceKind, AttributeSchema,
    ParameterModel, ParameterEncoding, PropertyModel,
} from '../../../src/model/types';

type SelectedEntity = FunctionModel | InterfaceModel | null;

interface Props {
    selected: SelectedEntity;
    schema: AttributeSchema;
    onUpdateFunction: (id: string, patch: { name?: string; language?: string; properties?: PropertyModel[] }) => void;
    onUpdateInterface: (id: string, patch: { name?: string; kind?: InterfaceKind; inheritPI?: boolean; parameters?: ParameterModel[] }) => void;
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

const BTN_SMALL: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid #45475a',
    borderRadius: 3,
    color: '#cdd6f4',
    cursor: 'pointer',
    fontSize: 10,
    padding: '1px 5px',
    lineHeight: 1.4,
};
const BTN_DANGER: React.CSSProperties = { ...BTN_SMALL, color: '#f38ba8', borderColor: '#f38ba8' };

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
const ENCODINGS: ParameterEncoding[] = ['NATIVE', 'ACN', 'UPER'];

// ── Inner panel: remounted when selected.id changes (via key prop) ────────

function AttributePanelInner({ selected, schema, onUpdateFunction, onUpdateInterface }: Props) {
    // Local mutable copies — initialised once from selected on mount/remount
    const [params, setParams] = useState<ParameterModel[]>(() =>
        selected && isInterface(selected) ? selected.parameters.map(p => ({ ...p })) : [],
    );
    const [fnProps, setFnProps] = useState<PropertyModel[]>(() =>
        selected && !isInterface(selected) ? (selected as FunctionModel).properties.map(p => ({ ...p })) : [],
    );

    if (!selected) { return null; }

    // ── Parameter helpers ─────────────────────────────────────────────────────

    const postParams = (next: ParameterModel[]) => {
        if (isInterface(selected)) { onUpdateInterface(selected.id, { parameters: next }); }
    };
    const updateParam = (i: number, patch: Partial<ParameterModel>) => {
        const next = params.map((p, idx) => idx === i ? { ...p, ...patch } : p);
        setParams(next); postParams(next);
    };
    const removeParam = (i: number) => {
        const next = params.filter((_, idx) => idx !== i);
        setParams(next); postParams(next);
    };
    const moveParam = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= params.length) { return; }
        const next = [...params]; [next[i], next[j]] = [next[j], next[i]];
        setParams(next); postParams(next);
    };
    const addParam = () => {
        const next = [...params, { name: 'param', type: 'T-Boolean', direction: 'input' as const, encoding: 'NATIVE' as const }];
        setParams(next); postParams(next);
    };

    // ── Function property helpers ─────────────────────────────────────────────

    const postFnProps = (next: PropertyModel[]) => {
        if (!isInterface(selected)) { onUpdateFunction(selected.id, { properties: next }); }
    };
    const updateFnProp = (i: number, patch: Partial<PropertyModel>) => {
        const next = fnProps.map((p, idx) => idx === i ? { ...p, ...patch } : p);
        setFnProps(next); postFnProps(next);
    };
    const removeFnProp = (i: number) => {
        const next = fnProps.filter((_, idx) => idx !== i);
        setFnProps(next); postFnProps(next);
    };
    const addFnProp = () => {
        const next = [...fnProps, { name: 'property', value: '' }];
        setFnProps(next); postFnProps(next);
    };

    // ── Interface panel ───────────────────────────────────────────────────────

    if (isInterface(selected)) {
        const iface = selected;
        const schemaAttrs = schema.attrs.filter(a =>
            a.scopes.includes(iface.type === 'provided' ? 'Provided_Interface' : 'Required_Interface')
            || a.scopes.includes(iface.type === 'provided' ? 'ProvidedInterface' : 'RequiredInterface'),
        );
        return (
            <div style={PANEL_STYLE}>
                <div style={{ fontWeight: 'bold', color: '#cba6f7', marginBottom: 8 }}>Interface</div>

                <div style={ROW}>
                    <span style={LABEL}>Name</span>
                    <input style={INPUT} defaultValue={iface.name}
                        onBlur={e => onUpdateInterface(iface.id, { name: e.target.value })} />
                </div>

                <Row label="Type" value={iface.type} />

                <div style={ROW}>
                    <span style={LABEL}>Kind</span>
                    <select style={SELECT} value={iface.kind}
                        onChange={e => onUpdateInterface(iface.id, { kind: e.target.value as InterfaceKind })}>
                        {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                </div>

                <Row label="Autonamed" value={iface.autonamed} />

                <div style={ROW}>
                    <span style={LABEL}>InheritPI</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#cdd6f4', fontSize: 11 }}>
                        <input type="checkbox" checked={iface.inheritPI} style={{ cursor: 'pointer' }}
                            onChange={e => onUpdateInterface(iface.id, { inheritPI: e.target.checked })} />
                        {iface.inheritPI ? 'Yes' : 'No'}
                    </label>
                </div>

                {/* Parameters — editable grid */}
                <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Parameters</span>
                    <button style={BTN_SMALL} onClick={addParam}>+ Add</button>
                </div>
                {params.map((p, i) => (
                    <div key={i} style={{ border: '1px solid #313244', borderRadius: 4, padding: '4px 6px', marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 3, marginBottom: 4 }}>
                            <button style={BTN_SMALL} disabled={i === 0} onClick={() => moveParam(i, -1)} title="Move up">↑</button>
                            <button style={BTN_SMALL} disabled={i === params.length - 1} onClick={() => moveParam(i, 1)} title="Move down">↓</button>
                            <button style={BTN_DANGER} onClick={() => removeParam(i)} title="Remove">✕</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={LABEL}>name</span>
                            <input style={INPUT} value={p.name} onChange={e => updateParam(i, { name: e.target.value })} />
                            <span style={LABEL}>type</span>
                            <input style={INPUT} value={p.type} onChange={e => updateParam(i, { type: e.target.value })} />
                            <span style={LABEL}>direction</span>
                            <select style={SELECT} value={p.direction}
                                onChange={e => updateParam(i, { direction: e.target.value as 'input' | 'output' })}>
                                <option value="input">input</option>
                                <option value="output">output</option>
                            </select>
                            <span style={LABEL}>encoding</span>
                            <select style={SELECT} value={p.encoding}
                                onChange={e => updateParam(i, { encoding: e.target.value as ParameterEncoding })}>
                                {ENCODINGS.map(enc => <option key={enc} value={enc}>{enc}</option>)}
                            </select>
                        </div>
                    </div>
                ))}

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
                        {iface.properties.map((prop, i) => (
                            <Row key={i} label={prop.name} value={prop.value} />
                        ))}
                    </>
                )}
            </div>
        );
    }

    // ── Function panel ────────────────────────────────────────────────────────

    const fn = selected as FunctionModel;
    const schemaAttrs = schema.attrs.filter(a => a.scopes.includes('Function'));
    return (
        <div style={PANEL_STYLE}>
            <div style={{ fontWeight: 'bold', color: '#cba6f7', marginBottom: 8 }}>Function</div>

            <div style={ROW}>
                <span style={LABEL}>Name</span>
                <input style={INPUT} defaultValue={fn.name}
                    onBlur={e => onUpdateFunction(fn.id, { name: e.target.value })} />
            </div>

            <div style={ROW}>
                <span style={LABEL}>Language</span>
                <select style={SELECT} value={fn.language}
                    onChange={e => onUpdateFunction(fn.id, { language: e.target.value })}>
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

            {/* Properties — editable list */}
            <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Properties</span>
                <button style={BTN_SMALL} onClick={addFnProp}>+ Add</button>
            </div>
            {fnProps.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 3, alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <input style={INPUT} value={p.name} placeholder="name"
                            onChange={e => updateFnProp(i, { name: e.target.value })} />
                        <input style={INPUT} value={p.value} placeholder="value"
                            onChange={e => updateFnProp(i, { value: e.target.value })} />
                    </div>
                    <button style={BTN_DANGER} onClick={() => removeFnProp(i)} title="Remove">✕</button>
                </div>
            ))}
        </div>
    );
}

// ── Public wrapper: forces remount when selected entity changes ───────────

export function AttributePanel(props: Props) {
    if (!props.selected) {
        return <div style={{ ...PANEL_STYLE, display: 'none' }} />;
    }
    return <AttributePanelInner key={props.selected.id} {...props} />;
}
