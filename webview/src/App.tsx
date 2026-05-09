import React, { useCallback, useEffect, useState } from 'react';
import {
    ReactFlow, Background, Controls, MiniMap,
    Node, Edge, NodeMouseHandler,
    useNodesState, useEdgesState,
    BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { DiagramData, ExtensionMessage, FunctionModel, InterfaceModel } from '../../src/model/types';
import { buildGraph } from './transform';
import { FunctionNode } from './components/FunctionNode';
import { InterfaceNode } from './components/InterfaceNode';
import { AttributePanel } from './components/AttributePanel';

const nodeTypes = {
    functionNode: FunctionNode,
    interfaceNode: InterfaceNode,
};

// VS Code webview API — injected by the host
declare const acquireVsCodeApi: () => { postMessage: (msg: unknown) => void };

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;
try { vscodeApi = acquireVsCodeApi(); } catch { /* running outside VS Code */ }

export default function App() {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [diagramData, setDiagramData] = useState<DiagramData | null>(null);
    const [selected, setSelected] = useState<FunctionModel | InterfaceModel | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [waiting, setWaiting] = useState(true);

    // Receive messages from extension
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data as ExtensionMessage;
            if (msg.type === 'load') {
                try {
                    setDiagramData(msg.data);
                    const { nodes: n, edges: e } = buildGraph(msg.data.iv, msg.data.ui);
                    setNodes(n);
                    setEdges(e);
                    setWaiting(false);
                } catch (err) {
                    setLoadError(String(err));
                    setWaiting(false);
                }
            }
        };
        window.addEventListener('message', handler);
        // Signal ready to extension host
        if (vscodeApi) {
            vscodeApi.postMessage({ type: 'ready' });
        } else {
            setLoadError('acquireVsCodeApi is not available (not running inside VS Code?)');
            setWaiting(false);
        }
        return () => window.removeEventListener('message', handler);
    }, [setNodes, setEdges]);

    const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
        if (!diagramData) { return; }
        const { iv } = diagramData;

        // Search all functions (incl. nested) for a matching Function or Interface id
        function findInFn(fn: FunctionModel): FunctionModel | InterfaceModel | null {
            if (fn.id === node.id) { return fn; }
            for (const iface of [...fn.providedInterfaces, ...fn.requiredInterfaces]) {
                if (iface.id === node.id) { return iface; }
            }
            for (const child of fn.nestedFunctions) {
                const found = findInFn(child);
                if (found) { return found; }
            }
            return null;
        }

        for (const fn of iv.functions) {
            const found = findInFn(fn);
            if (found) { setSelected(found); return; }
        }
    }, [diagramData]);

    const onPaneClick = useCallback(() => setSelected(null), []);

    if (waiting) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: '#1e1e2e', color: '#cdd6f4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
                Loading diagram…
            </div>
        );
    }

    if (loadError) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: '#1e1e2e', color: '#f38ba8', padding: '2rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                Error: {loadError}
            </div>
        );
    }

    return (
        <div style={{ width: '100vw', height: '100vh', background: '#1e1e2e', position: 'relative' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                fitView
                minZoom={0.05}
                maxZoom={4}
                style={{ background: '#1e1e2e' }}
            >
                <Background color="#313244" variant={BackgroundVariant.Dots} />
                <Controls />
                <MiniMap
                    nodeColor={(n) => n.type === 'interfaceNode' ? '#89b4fa' : '#313244'}
                    style={{ background: '#181825' }}
                />
            </ReactFlow>

            <AttributePanel
                selected={selected}
                schema={diagramData?.schema ?? { attrs: [] }}
            />
        </div>
    );
}
