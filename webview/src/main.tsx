import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DvApp from './DvApp';

const root = document.getElementById('root');
if (root) {
    const editorKind = document.body.dataset.editorKind;
    createRoot(root).render(editorKind === 'dv' ? <DvApp /> : <App />);
}
