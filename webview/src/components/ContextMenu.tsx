import React, { useEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
    label: string;
    onClick?: () => void;
    danger?: boolean;
    children?: ContextMenuItem[];
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
                zIndex: 1000,
            }}
        >
            <ContextMenuPanel items={items} onClose={onClose} />
        </div>
    );
}

function ContextMenuPanel({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
    const [openChildIndex, setOpenChildIndex] = useState<number | null>(null);

    return (
        <div
            style={{
                background: '#1e1e2e',
                border: '1px solid #45475a',
                borderRadius: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                minWidth: 180,
                overflow: 'visible',
            }}
        >
            {items.map((item, index) => {
                const hasChildren = (item.children?.length ?? 0) > 0;
                return (
                    <div
                        key={`${item.label}-${index}`}
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setOpenChildIndex(hasChildren ? index : null)}
                        onMouseLeave={() => setOpenChildIndex(current => current === index ? null : current)}
                    >
                        <button
                            onClick={() => {
                                if (hasChildren) {
                                    return;
                                }
                                item.onClick?.();
                                onClose();
                            }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
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
                            onMouseEnter={event => (event.currentTarget.style.background = '#313244')}
                            onMouseLeave={event => (event.currentTarget.style.background = 'none')}
                        >
                            <span>{item.label}</span>
                            {hasChildren && <span style={{ marginLeft: 12, color: '#a6adc8' }}>›</span>}
                        </button>
                        {hasChildren && openChildIndex === index && (
                            <div style={{ position: 'absolute', left: '100%', top: -1, marginLeft: 4, zIndex: 1001 }}>
                                <ContextMenuPanel items={item.children ?? []} onClose={onClose} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
