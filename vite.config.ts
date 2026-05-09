import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: path.resolve(__dirname, 'out/webview'),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'webview/index.html'),
        },
    },
    root: path.resolve(__dirname, 'webview'),
});
