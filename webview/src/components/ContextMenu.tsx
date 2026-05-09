import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
}

interface Props {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    return (
        <div
            ref={ref}
            style={{
                position: 'fixed',
                left: x,
                top: y,
                background: '#1e1e2e',
                border: '1px solid #45475a',
                borderRadius: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                zIndex: 1000,
                minWidth: 180,
                overflow: 'hidden',
            }}
        >
            {items.map((item, i) => (
                <button
                    key={i}
                    onClick={() => { item.onClick(); onClose(); }}
                    style={{
                        display: 'block',
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        padding: '8px 14px',
                        textAlign: 'left',
                        color: item.danger ? '#f38ba8' : '#cdd6f4',
                        fontSize: 13,
                        fontFamily: 'sans-serif',
                        cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#313244')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
