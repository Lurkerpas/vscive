import React from 'react';

interface PaletteProps {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFitView: () => void;
    onShowOptions: () => void;
    onAddFunction: () => void;
    onAddConnection: () => void;
    connectMode: boolean;
    locked: boolean;
    onToggleLock: () => void;
    optionsVisible: boolean;
}

const PALETTE_STYLE: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '8px 4px',
    background: '#181825',
    borderRight: '1px solid #313244',
    zIndex: 20,
};

function PaletteBtn({
    title,
    onClick,
    active,
    danger,
    children,
}: {
    title: string;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    children: React.ReactNode;
}) {
    const [hovered, setHovered] = React.useState(false);
    const bg = active ? '#45475a' : hovered ? '#313244' : 'transparent';
    const color = danger ? '#f38ba8' : active ? '#89b4fa' : '#cdd6f4';
    return (
        <button
            title={title}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                background: bg,
                border: 'none',
                borderRadius: 6,
                color,
                cursor: 'pointer',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                transition: 'background 0.1s',
                padding: 0,
            }}
        >
            {children}
        </button>
    );
}

export function Palette({
    onZoomIn,
    onZoomOut,
    onFitView,
    onShowOptions,
    onAddFunction,
    onAddConnection,
    connectMode,
    locked,
    onToggleLock,
    optionsVisible,
}: PaletteProps) {
    return (
        <div style={PALETTE_STYLE}>
            <PaletteBtn title="Zoom In" onClick={onZoomIn}>＋</PaletteBtn>
            <PaletteBtn title="Zoom Out" onClick={onZoomOut}>－</PaletteBtn>
            <PaletteBtn title="Zoom to Fit" onClick={onFitView}>⊡</PaletteBtn>
            <div style={{ width: 24, height: 1, background: '#45475a', margin: '4px 0' }} />
            <PaletteBtn title="Show Options" onClick={onShowOptions} active={optionsVisible}>⚙</PaletteBtn>
            <PaletteBtn title="Add Function" onClick={onAddFunction}>＋▭</PaletteBtn>
            <PaletteBtn title="Add Connection" onClick={onAddConnection} active={connectMode}>⇝</PaletteBtn>
            <div style={{ width: 24, height: 1, background: '#45475a', margin: '4px 0' }} />
            <PaletteBtn title={locked ? 'Unlock Diagram' : 'Lock Diagram from Modification'} onClick={onToggleLock} active={locked} danger={locked}>
                {locked ? '🔒' : '🔓'}
            </PaletteBtn>
        </div>
    );
}
