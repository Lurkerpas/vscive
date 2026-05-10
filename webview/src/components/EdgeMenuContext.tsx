import { createContext, useContext } from 'react';
import { ContextMenuItem } from './ContextMenu';

interface EdgeMenuContextValue {
    showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
}

export const EdgeMenuContext = createContext<EdgeMenuContextValue>({
    showContextMenu: () => {},
});

export function useEdgeMenu(): EdgeMenuContextValue {
    return useContext(EdgeMenuContext);
}
