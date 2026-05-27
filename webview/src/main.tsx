import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DvApp from './DvApp';
import SdlApp from './SdlApp';

const root = document.getElementById('root');
if (root) {
    const editorKind = document.body.dataset.editorKind;
    const element = editorKind === 'dv' ? <DvApp /> : editorKind === 'sdl' ? <SdlApp /> : <App />;
    createRoot(root).render(element);
}
