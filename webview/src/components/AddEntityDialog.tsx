import React, { useState, useCallback } from 'react';
import { InterfaceKind, AttributeSchema } from '../../../src/model/types';

interface AddFunctionState {
    kind: 'addFunction';
    rfX: number;
    rfY: number;
    parentId?: string;
}

interface AddInterfaceState {
    kind: 'addInterface';
    funcId: string;
    funcName: string;
    presetType?: 'provided' | 'required';
}

export interface SearchFunctionState {
    kind: 'searchFunction';
}

export type DialogState = AddFunctionState | AddInterfaceState | SearchFunctionState | null;

interface Props {
    state: DialogState;
    schema?: AttributeSchema;
    onConfirmFunction: (name: string, language: string, rfX: number, rfY: number, parentId?: string) => void;
    onConfirmInterface: (name: string, kind: InterfaceKind, ifaceType: 'provided' | 'required', funcId: string) => void;
    onCancel: () => void;
}

const FALLBACK_LANGUAGES = ['C', 'Ada', 'C_Sharp', 'Blackbox_C', 'SDL', 'Simulink', 'VHDL', 'MicroPython', 'CPP', 'Lustre'];
function getLanguages(schema?: AttributeSchema): string[] {
    const attr = schema?.attrs.find(a => a.name === 'language');
    if (attr && attr.type.kind === 'enumeration' && attr.type.entries.length > 0) {
        return attr.type.entries;
    }
    return FALLBACK_LANGUAGES;
}
// Cyclic RI is not allowed (REQ-0112); PI may be Cyclic
const PI_KINDS: InterfaceKind[] = ['Sporadic', 'Protected', 'Unprotected', 'Cyclic'];
const RI_KINDS: InterfaceKind[] = ['Sporadic', 'Protected', 'Unprotected'];

const OVERLAY: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
};
const DIALOG: React.CSSProperties = {
    background: '#1e1e2e',
    border: '1px solid #45475a',
    borderRadius: 8,
    padding: 20,
    minWidth: 300,
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};
const TITLE: React.CSSProperties = { color: '#cba6f7', fontWeight: 'bold', fontSize: 14, marginBottom: 14, fontFamily: 'sans-serif' };
const LABEL: React.CSSProperties = { color: '#a6adc8', fontSize: 12, display: 'block', marginBottom: 4, fontFamily: 'sans-serif' };
const INPUT: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: '#181825', color: '#cdd6f4', border: '1px solid #45475a',
    borderRadius: 4, padding: '5px 8px', fontSize: 12, fontFamily: 'monospace',
    marginBottom: 12,
};
const BTN_ROW: React.CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 };
const BTN = (primary: boolean): React.CSSProperties => ({
    padding: '5px 16px', borderRadius: 4, border: 'none', cursor: 'pointer',
    fontSize: 12, fontFamily: 'sans-serif',
    background: primary ? '#89b4fa' : '#313244',
    color: primary ? '#1e1e2e' : '#cdd6f4',
});

export function AddEntityDialog({ state, schema, onConfirmFunction, onConfirmInterface, onCancel }: Props) {
    const languages = getLanguages(schema);
    const defaultLang = languages[0] ?? 'C';
    const [name, setName] = useState('');
    const [language, setLanguage] = useState(defaultLang);
    const [kind, setKind] = useState<InterfaceKind>('Sporadic');
    const [ifaceType, setIfaceType] = useState<'provided' | 'required'>('provided');

    const resetAndCancel = useCallback(() => {
        setName(''); setLanguage(defaultLang); setKind('Sporadic'); setIfaceType('provided');
        onCancel();
    }, [onCancel, defaultLang]);

    const submit = useCallback(() => {
        if (!name.trim()) { return; }
        if (state?.kind === 'addFunction') {
            onConfirmFunction(name.trim(), language, state.rfX, state.rfY, state.parentId);
        } else if (state?.kind === 'addInterface') {
            onConfirmInterface(name.trim(), kind, state.presetType ?? ifaceType, state.funcId);
        }
        setName(''); setLanguage(defaultLang); setKind('Sporadic'); setIfaceType('provided');
    }, [state, name, language, kind, ifaceType, defaultLang, onConfirmFunction, onConfirmInterface]);

    if (!state || state.kind === 'searchFunction') { return null; }

    return (
        <div style={OVERLAY} onMouseDown={e => { if (e.target === e.currentTarget) { resetAndCancel(); } }}>
            <div style={DIALOG}>
                {state.kind === 'addFunction' ? (
                    <>
                        <div style={TITLE}>Add Function</div>
                        <label style={LABEL}>Name</label>
                        <input
                            autoFocus
                            style={INPUT}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { submit(); } if (e.key === 'Escape') { resetAndCancel(); } }}
                        />
                        <label style={LABEL}>Language</label>
                        <select style={INPUT} value={language} onChange={e => setLanguage(e.target.value)}>
                            {languages.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </>
                ) : (
                    <>
                        <div style={TITLE}>Add Interface to "{(state as AddInterfaceState).funcName}"</div>
                        <label style={LABEL}>Name</label>
                        <input
                            autoFocus
                            style={INPUT}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { submit(); } if (e.key === 'Escape') { resetAndCancel(); } }}
                        />
                        {!state.presetType && (
                            <>
                                <label style={LABEL}>Type</label>
                                <select style={INPUT} value={ifaceType} onChange={e => setIfaceType(e.target.value as 'provided' | 'required')}>
                                    <option value="provided">Provided</option>
                                    <option value="required">Required</option>
                                </select>
                            </>
                        )}
                        <label style={LABEL}>Kind</label>
                        <select style={INPUT} value={kind} onChange={e => setKind(e.target.value as InterfaceKind)}>
                            {((state.presetType ?? ifaceType) === 'required' ? RI_KINDS : PI_KINDS).map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                    </>
                )}
                <div style={BTN_ROW}>
                    <button style={BTN(false)} onClick={resetAndCancel}>Cancel</button>
                    <button style={BTN(true)} onClick={submit} disabled={!name.trim()}>Add</button>
                </div>
            </div>
        </div>
    );
}
