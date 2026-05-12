import React, { useState } from 'react';
import {
    FunctionModel, InterfaceModel, InterfaceKind, AttributeSchema,
    ContextParameterModel, ParameterModel, ParameterEncoding, PropertyModel, AttrDef, AttrValidator,
} from '../../../src/model/types';

type SelectedEntity = FunctionModel | InterfaceModel | null;

interface Props {
    selected: SelectedEntity;
    schema: AttributeSchema;
    locked?: boolean;
    /** When set, the selected RI is connected: show these PI params as locked/read-only. */
    connectedPiParams?: ParameterModel[];
    onUpdateFunction: (id: string, patch: { name?: string; language?: string; defaultImplementation?: string; isType?: boolean; fixedSystemElement?: boolean; contextParameters?: ContextParameterModel[]; properties?: PropertyModel[]; extraAttrs?: Record<string, string> }) => void;
    onUpdateInterface: (id: string, patch: { name?: string; kind?: InterfaceKind; inheritPI?: boolean; parameters?: ParameterModel[]; extraAttrs?: Record<string, string> }) => void;
}

/** Extract language entries from the schema's 'language' attr, falling back to a built-in list. */
function schemaLanguages(schema: AttributeSchema): string[] {
    const attr = schema.attrs.find(a => a.name === 'language');
    if (attr && attr.type.kind === 'enumeration' && attr.type.entries.length > 0) {
        return attr.type.entries;
    }
    return ['C', 'Ada', 'C_Sharp', 'Blackbox_C', 'Blackbox_Device', 'SDL', 'Simulink', 'VHDL', 'MicroPython', 'RTDS', 'Taste_Dataview', 'Pohic', 'CPP', 'System_C', 'Lustre', 'SCADE'];
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

// KINDS for RI excludes Cyclic (REQ-0112: Cyclic RI disallowed)
const PI_KINDS: InterfaceKind[] = ['Sporadic', 'Cyclic', 'Protected', 'Unprotected'];
const RI_KINDS: InterfaceKind[] = ['Sporadic', 'Protected', 'Unprotected'];
const ENCODINGS: ParameterEncoding[] = ['NATIVE', 'ACN', 'UPER'];

// ── Validator helpers ─────────────────────────────────────────────────────

/** Group validators by name; each group is OR'd, groups are AND'd. */
function checkValidators(validators: AttrValidator[], lookup: (name: string) => string): boolean {
    if (!validators || validators.length === 0) { return true; }
    const byName = new Map<string, string[]>();
    for (const v of validators) {
        if (!byName.has(v.name)) { byName.set(v.name, []); }
        byName.get(v.name)!.push(v.value);
    }
    for (const [name, allowed] of byName) {
        if (!allowed.includes(lookup(name))) { return false; }
    }
    return true;
}

function ifaceAttrLookup(iface: InterfaceModel, extraAttrs: Record<string, string>): (name: string) => string {
    return (name: string) => {
        if (name === 'kind') { return iface.kind; }
        return extraAttrs[name] ?? iface.extraAttrs[name] ?? '';
    };
}

function fnAttrLookup(fn: FunctionModel, extraAttrs: Record<string, string>): (name: string) => string {
    return (name: string) => {
        if (name === 'is_type') { return fn.isType ? 'YES' : 'NO'; }
        return extraAttrs[name] ?? fn.extraAttrs[name] ?? '';
    };
}

/** Filter schema attrs applicable to a given scope with validator conditions checked.
 *  Also includes attrs that are present in entityExtraAttrs even if the scope doesn't match,
 *  so RI elements carrying PI-scoped attrs (wcet, stack_size, …) are still editable. */
function filterAttrs(
    schema: { attrs: AttrDef[] },
    scope1: string,
    scope2: string,
    lookup: (name: string) => string,
    entityExtraAttrs?: Record<string, string>,
    excludedNames: ReadonlySet<string> = new Set(),
): AttrDef[] {
    return schema.attrs.filter(a => {
        if (excludedNames.has(a.name)) { return false; }
        if (!a.visible) { return false; }
        if (!a.label) { return false; } // unnamed / internal attrs
        const matchedScope = a.scopes.find(s => s === scope1 || s === scope2);
        if (matchedScope) {
            // In-scope: apply validators
            const validators = a.scopeValidators?.[matchedScope] ?? [];
            return checkValidators(validators, lookup);
        }
        // Out-of-scope but value is present in entity extraAttrs → show it anyway
        return entityExtraAttrs !== undefined && Object.prototype.hasOwnProperty.call(entityExtraAttrs, a.name);
    });
}

// ── Inner panel: remounted when selected.id changes (via key prop) ────────

/** Render one schema attribute as an editable field. */
function SchemaAttrField({ attrDef, value, onChange, onBlur }: {
    attrDef: AttrDef;
    value: string;
    onChange?: (v: string) => void;
    onBlur?: (v: string) => void;
}) {
    if (attrDef.type.kind === 'enumeration') {
        const entries = attrDef.type.entries;
        return (
            <div style={ROW}>
                <span style={LABEL}>{attrDef.label}</span>
                <select style={SELECT} value={value || attrDef.type.defaultValue}
                    onChange={e => onChange?.(e.target.value)}>
                    {entries.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
            </div>
        );
    }
    // String type
    return (
        <div style={ROW}>
            <span style={LABEL}>{attrDef.label}</span>
            <input style={INPUT} defaultValue={value}
                onBlur={e => onBlur?.(e.target.value)} />
        </div>
    );
}

function AttributePanelInner({ selected, schema, locked = false, connectedPiParams, onUpdateFunction, onUpdateInterface }: Props) {
    // Local mutable copies — initialised once from selected on mount/remount
    const [params, setParams] = useState<ParameterModel[]>(() =>
        selected && isInterface(selected) ? selected.parameters.map(p => ({ ...p })) : [],
    );
    const [fnContextParameters, setFnContextParameters] = useState<ContextParameterModel[]>(() =>
        selected && !isInterface(selected) ? ((selected as FunctionModel).contextParameters ?? []).map(p => ({ ...p, extraAttrs: { ...p.extraAttrs } })) : [],
    );
    const [fnProps, setFnProps] = useState<PropertyModel[]>(() =>
        selected && !isInterface(selected) ? (selected as FunctionModel).properties.map(p => ({ ...p })) : [],
    );
    const [extraAttrs, setExtraAttrs] = useState<Record<string, string>>(() =>
        selected ? { ...(isInterface(selected) ? selected.extraAttrs : (selected as FunctionModel).extraAttrs) } : {},
    );

    if (!selected) { return null; }

    // ── ExtraAttr helpers ─────────────────────────────────────────────────────

    const updateExtraAttr = (name: string, value: string) => {
        const next = { ...extraAttrs, [name]: value };
        setExtraAttrs(next);
        if (isInterface(selected)) {
            onUpdateInterface(selected.id, { extraAttrs: { [name]: value } });
        } else {
            onUpdateFunction(selected.id, { extraAttrs: { [name]: value } });
        }
    };

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

    // ── Function context parameter helpers ───────────────────────────────────

    const postFnContextParameters = (next: ContextParameterModel[]) => {
        if (!isInterface(selected)) { onUpdateFunction(selected.id, { contextParameters: next }); }
    };
    const updateFnContextParameter = (i: number, patch: Partial<ContextParameterModel>) => {
        const next = fnContextParameters.map((p, idx) => idx === i ? { ...p, ...patch } : p);
        setFnContextParameters(next); postFnContextParameters(next);
    };
    const removeFnContextParameter = (i: number) => {
        const next = fnContextParameters.filter((_, idx) => idx !== i);
        setFnContextParameters(next); postFnContextParameters(next);
    };
    const moveFnContextParameter = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= fnContextParameters.length) { return; }
        const next = [...fnContextParameters];
        [next[i], next[j]] = [next[j], next[i]];
        setFnContextParameters(next); postFnContextParameters(next);
    };
    const addFnContextParameter = () => {
        const next = [...fnContextParameters, { name: 'context_parameter', type: 'Timer', value: '', extraAttrs: {} }];
        setFnContextParameters(next); postFnContextParameters(next);
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
        const piScope = 'Provided_Interface' as const;
        const riScope = 'Required_Interface' as const;
        const scope1 = iface.type === 'provided' ? piScope : riScope;
        const scope2 = iface.type === 'provided' ? 'ProvidedInterface' as const : 'RequiredInterface' as const;
        const lookup = ifaceAttrLookup(iface, extraAttrs);
        const schemaAttrs = filterAttrs(
            schema,
            scope1,
            scope2,
            lookup,
            iface.extraAttrs,
            new Set(['name', 'kind', 'type', 'autonamed', 'inheritPI']),
        );
        const kindOptions = iface.type === 'provided' ? PI_KINDS : RI_KINDS;
        // For a connected RI, params are locked and inherited from the PI
        const paramsLocked = iface.type === 'required' && connectedPiParams !== undefined;
        const displayParams = paramsLocked ? connectedPiParams! : params;
        return (
            <div style={{ ...PANEL_STYLE, ...(locked ? { opacity: 0.75, pointerEvents: 'none' as const } : {}) }}>
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
                        {kindOptions.map(k => <option key={k} value={k}>{k}</option>)}
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

                {/* Parameters — editable grid, or locked inherited params for connected RIs */}
                <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Parameters{paramsLocked && <span style={{ color: '#a6adc8', fontWeight: 'normal' }}> (inherited, locked)</span>}</span>
                    {!paramsLocked && <button style={BTN_SMALL} onClick={addParam}>+ Add</button>}
                </div>
                {displayParams.map((p, i) => (
                    <div key={i} style={{ border: '1px solid #313244', borderRadius: 4, padding: '4px 6px', marginBottom: 6 }}>
                        {!paramsLocked && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 3, marginBottom: 4 }}>
                                <button style={BTN_SMALL} disabled={i === 0} onClick={() => moveParam(i, -1)} title="Move up">↑</button>
                                <button style={BTN_SMALL} disabled={i === params.length - 1} onClick={() => moveParam(i, 1)} title="Move down">↓</button>
                                <button style={BTN_DANGER} onClick={() => removeParam(i)} title="Remove">✕</button>
                            </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={LABEL}>name</span>
                            {paramsLocked
                                ? <span style={STATIC}>{p.name}</span>
                                : <input style={INPUT} value={p.name} onChange={e => updateParam(i, { name: e.target.value })} />}
                            <span style={LABEL}>type</span>
                            {paramsLocked
                                ? <span style={STATIC}>{p.type}</span>
                                : <input style={INPUT} value={p.type} onChange={e => updateParam(i, { type: e.target.value })} />}
                            <span style={LABEL}>direction</span>
                            {paramsLocked
                                ? <span style={STATIC}>{p.direction}</span>
                                : <select style={SELECT} value={p.direction}
                                    onChange={e => updateParam(i, { direction: e.target.value as 'input' | 'output' })}>
                                    <option value="input">input</option>
                                    <option value="output">output</option>
                                </select>}
                            <span style={LABEL}>encoding</span>
                            {paramsLocked
                                ? <span style={STATIC}>{p.encoding}</span>
                                : <select style={SELECT} value={p.encoding}
                                    onChange={e => updateParam(i, { encoding: e.target.value as ParameterEncoding })}>
                                    {ENCODINGS.map(enc => <option key={enc} value={enc}>{enc}</option>)}
                                </select>}
                        </div>
                    </div>
                ))}

                {schemaAttrs.length > 0 && (
                    <>
                        <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                            Attributes
                        </div>
                        {schemaAttrs.map((a, i) => (
                            <SchemaAttrField
                                key={a.name}
                                attrDef={a}
                                value={extraAttrs[a.name] ?? iface.extraAttrs[a.name] ?? (a.type.kind === 'enumeration' ? a.type.defaultValue : (a.type.defaultValue ?? ''))}
                                onChange={v => updateExtraAttr(a.name, v)}
                                onBlur={v => updateExtraAttr(a.name, v)}
                            />
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
    const fnLookup = fnAttrLookup(fn, extraAttrs);
    // Exclude attrs that are managed as dedicated typed fields to avoid duplication
    const schemaAttrs = filterAttrs(
        schema,
        'Function',
        'Function',
        fnLookup,
        fn.extraAttrs,
        new Set(['name', 'language', 'default_implementation', 'is_type', 'fixed_system_element', 'required_system_element']),
    );
    const languages = schemaLanguages(schema);
    return (
        <div style={{ ...PANEL_STYLE, ...(locked ? { opacity: 0.75, pointerEvents: 'none' as const } : {}) }}>
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
                    {languages.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
            </div>

            <div style={ROW}>
                <span style={LABEL}>Default Implementation</span>
                <input style={INPUT} defaultValue={fn.defaultImplementation}
                    onBlur={e => onUpdateFunction(fn.id, { defaultImplementation: e.target.value })} />
            </div>

            <div style={ROW}>
                <span style={LABEL}>Is Type</span>
                <select style={SELECT} value={fn.isType ? 'YES' : 'NO'}
                    onChange={e => onUpdateFunction(fn.id, { isType: e.target.value === 'YES' })}>
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                </select>
            </div>

            <div style={ROW}>
                <span style={LABEL}>Fixed System Element</span>
                <select style={SELECT} value={fn.fixedSystemElement ? 'YES' : 'NO'}
                    onChange={e => onUpdateFunction(fn.id, { fixedSystemElement: e.target.value === 'YES' })}>
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                </select>
            </div>

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
                        Attributes
                    </div>
                    {schemaAttrs.map((a) => (
                        <SchemaAttrField
                            key={a.name}
                            attrDef={a}
                            value={extraAttrs[a.name] ?? fn.extraAttrs[a.name] ?? (a.type.kind === 'enumeration' ? a.type.defaultValue : (a.type.defaultValue ?? ''))}
                            onChange={v => updateExtraAttr(a.name, v)}
                            onBlur={v => updateExtraAttr(a.name, v)}
                        />
                    ))}
                </>
            )}

            <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Context Parameters</span>
                <button style={BTN_SMALL} onClick={addFnContextParameter}>+ Add</button>
            </div>
            {fnContextParameters.map((p, i) => (
                <div key={i} style={{ border: '1px solid #313244', borderRadius: 4, padding: '4px 6px', marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 3, marginBottom: 4 }}>
                        <button style={BTN_SMALL} disabled={i === 0} onClick={() => moveFnContextParameter(i, -1)} title="Move up">↑</button>
                        <button style={BTN_SMALL} disabled={i === fnContextParameters.length - 1} onClick={() => moveFnContextParameter(i, 1)} title="Move down">↓</button>
                        <button style={BTN_DANGER} onClick={() => removeFnContextParameter(i)} title="Remove">✕</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={LABEL}>name</span>
                        <input style={INPUT} value={p.name} onChange={e => updateFnContextParameter(i, { name: e.target.value })} />
                        <span style={LABEL}>type</span>
                        <input style={INPUT} value={p.type} onChange={e => updateFnContextParameter(i, { type: e.target.value })} />
                        <span style={LABEL}>value</span>
                        <input style={INPUT} value={p.value} onChange={e => updateFnContextParameter(i, { value: e.target.value })} />
                    </div>
                </div>
            ))}

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
