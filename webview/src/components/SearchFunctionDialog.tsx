import React, { useEffect, useMemo, useState } from 'react';

interface SearchableFunction {
    id: string;
    name: string;
    language: string;
}

interface Props {
    open: boolean;
    functions: SearchableFunction[];
    onSelect: (functionId: string) => void;
    onCancel: () => void;
}

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
    minWidth: 420,
    maxWidth: 640,
    maxHeight: '70vh',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
};
const TITLE: React.CSSProperties = { color: '#cba6f7', fontWeight: 'bold', fontSize: 14, fontFamily: 'sans-serif' };
const LABEL: React.CSSProperties = { color: '#a6adc8', fontSize: 12, display: 'block', marginBottom: 4, fontFamily: 'sans-serif' };
const INPUT: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: '#181825', color: '#cdd6f4', border: '1px solid #45475a',
    borderRadius: 4, padding: '7px 9px', fontSize: 12, fontFamily: 'monospace',
};
const LIST: React.CSSProperties = {
    background: '#181825',
    border: '1px solid #45475a',
    borderRadius: 6,
    overflow: 'auto',
    minHeight: 180,
};
const BTN: React.CSSProperties = {
    padding: '5px 16px', borderRadius: 4, border: 'none', cursor: 'pointer',
    fontSize: 12, fontFamily: 'sans-serif', background: '#313244', color: '#cdd6f4',
    alignSelf: 'flex-end',
};

function functionCaption(fn: SearchableFunction): string {
    return fn.language ? `${fn.name} [${fn.language}]` : fn.name;
}

export function SearchFunctionDialog({ open, functions, onSelect, onCancel }: Props) {
    const [pattern, setPattern] = useState('');
    const [highlightedId, setHighlightedId] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setPattern('');
            setHighlightedId(null);
        }
    }, [open]);

    const { filteredFunctions, regexError } = useMemo(() => {
        if (!pattern.trim()) {
            return { filteredFunctions: functions, regexError: null as string | null };
        }

        try {
            const rx = new RegExp(pattern, 'i');
            return {
                filteredFunctions: functions.filter(fn => rx.test(functionCaption(fn))),
                regexError: null as string | null,
            };
        } catch (error) {
            return {
                filteredFunctions: [] as SearchableFunction[],
                regexError: error instanceof Error ? error.message : 'Invalid regular expression',
            };
        }
    }, [functions, pattern]);

    useEffect(() => {
        setHighlightedId(filteredFunctions[0]?.id ?? null);
    }, [filteredFunctions]);

    if (!open) { return null; }

    const choose = (functionId: string) => {
        onSelect(functionId);
        setPattern('');
        setHighlightedId(null);
    };

    return (
        <div style={OVERLAY} onMouseDown={event => { if (event.target === event.currentTarget) { onCancel(); } }}>
            <div style={DIALOG}>
                <div style={TITLE}>Search Function</div>
                <div>
                    <label style={LABEL}>Regexp Filter (case-insensitive)</label>
                    <input
                        autoFocus
                        style={INPUT}
                        value={pattern}
                        onChange={event => setPattern(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Escape') { onCancel(); }
                            if (event.key === 'Enter' && highlightedId) { choose(highlightedId); }
                        }}
                    />
                    {regexError && <div style={{ color: '#f38ba8', fontFamily: 'monospace', fontSize: 12, marginTop: 6 }}>{regexError}</div>}
                </div>
                <div style={LIST}>
                    {filteredFunctions.length === 0 ? (
                        <div style={{ color: '#a6adc8', fontFamily: 'sans-serif', fontSize: 12, padding: 12 }}>
                            No matching functions.
                        </div>
                    ) : filteredFunctions.map(fn => {
                        const active = fn.id === highlightedId;
                        return (
                            <button
                                key={fn.id}
                                onMouseEnter={() => setHighlightedId(fn.id)}
                                onClick={() => choose(fn.id)}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    background: active ? '#313244' : 'none',
                                    border: 'none',
                                    borderBottom: '1px solid #313244',
                                    padding: '9px 12px',
                                    textAlign: 'left',
                                    color: '#cdd6f4',
                                    fontSize: 12,
                                    fontFamily: 'sans-serif',
                                    cursor: 'pointer',
                                }}
                            >
                                {functionCaption(fn)}
                            </button>
                        );
                    })}
                </div>
                <button style={BTN} onClick={onCancel}>Close</button>
            </div>
        </div>
    );
}