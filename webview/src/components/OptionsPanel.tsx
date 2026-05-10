import React from 'react';
import { EditorOptions, DEFAULT_OPTIONS } from '../../../src/model/types';

export type { EditorOptions };
export { DEFAULT_OPTIONS };

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

interface OptionsPanelProps {
    options: EditorOptions;
    onChange: (patch: Partial<EditorOptions>) => void;
    onBrowseAttrFile: () => void;
}

export function OptionsPanel({ options, onChange, onBrowseAttrFile }: OptionsPanelProps) {
    return (
        <div style={PANEL_STYLE}>
            <div style={{ fontWeight: 'bold', color: '#cba6f7', marginBottom: 8 }}>
                Options
            </div>

            <div style={ROW}>
                <span style={LABEL}>Attributes File</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                        type="text"
                        value={options.attrFilePath}
                        onChange={e => onChange({ attrFilePath: e.target.value })}
                        placeholder="(default / not set)"
                        style={{ ...INPUT, flex: 1 }}
                    />
                    <button
                        onClick={onBrowseAttrFile}
                        title="Browse…"
                        style={{ background: '#313244', color: '#cdd6f4', border: '1px solid #45475a', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >…</button>
                </div>
                <span style={{ color: '#6c7086', fontSize: 10 }}>Changing reloads the diagram schema.</span>
            </div>

            <div style={ROW}>
                <span style={LABEL}>Canvas Background Color</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                        type="color"
                        value={options.canvasColor}
                        onChange={e => onChange({ canvasColor: e.target.value })}
                        style={{ width: 36, height: 24, padding: 0, border: 'none', cursor: 'pointer', background: 'none' }}
                    />
                    <input
                        type="text"
                        value={options.canvasColor}
                        onChange={e => onChange({ canvasColor: e.target.value })}
                        style={{ ...INPUT, flex: 1 }}
                    />
                </div>
            </div>

            <div style={ROW}>
                <span style={LABEL}>Snap to Grid</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#cdd6f4', fontSize: 11, padding: '2px 0' }}>
                    <input
                        type="checkbox"
                        checked={options.snapEnabled}
                        onChange={e => onChange({ snapEnabled: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                    />
                    Enabled
                </label>
            </div>

            <div style={ROW}>
                <span style={LABEL}>Snap Grid Size (flow-px)</span>
                <input
                    type="number"
                    min={4}
                    max={500}
                    value={options.snapGridSize}
                    onChange={e => onChange({ snapGridSize: Math.max(4, Number(e.target.value) || 20) })}
                    style={INPUT}
                />
            </div>

            <div style={{ color: '#89b4fa', marginTop: 8, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                Font Sizes (flow-px)
            </div>

            <div style={ROW}>
                <span style={LABEL}>Function Header</span>
                <input
                    type="number"
                    min={20}
                    max={300}
                    value={options.fontSizeFn}
                    onChange={e => onChange({ fontSizeFn: Math.max(20, Number(e.target.value) || 90) })}
                    style={INPUT}
                />
            </div>

            <div style={ROW}>
                <span style={LABEL}>Interface Label</span>
                <input
                    type="number"
                    min={10}
                    max={200}
                    value={options.fontSizeIface}
                    onChange={e => onChange({ fontSizeIface: Math.max(10, Number(e.target.value) || 45) })}
                    style={INPUT}
                />
            </div>

            <div style={ROW}>
                <span style={LABEL}>Connection Label</span>
                <input
                    type="number"
                    min={6}
                    max={100}
                    value={options.fontSizeConn}
                    onChange={e => onChange({ fontSizeConn: Math.max(6, Number(e.target.value) || 11) })}
                    style={INPUT}
                />
            </div>

            <div style={{ color: '#a6adc8', fontSize: 10, marginTop: 16, lineHeight: 1.5 }}>
                Font sizes are in diagram space units (same scale as node dimensions).
                Reload diagram after changing to see effect on connections.
            </div>

            <div style={{ color: '#89b4fa', marginTop: 12, marginBottom: 4, fontSize: 11, fontWeight: 'bold' }}>
                History
            </div>

            <div style={ROW}>
                <span style={LABEL}>Undo / Redo Depth</span>
                <input
                    type="number"
                    min={1}
                    max={1000}
                    value={options.undoDepth}
                    onChange={e => onChange({ undoDepth: Math.max(1, Number(e.target.value) || 50) })}
                    style={INPUT}
                />
                <span style={{ color: '#6c7086', fontSize: 10 }}>Maximum number of undo steps retained.</span>
            </div>
        </div>
    );
}
