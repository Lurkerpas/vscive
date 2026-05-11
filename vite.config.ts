import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: path.resolve(__dirname, 'out/webview'),
        emptyOutDir: true,
        assetsDir: 'assets',
        rollupOptions: {
            input: path.resolve(__dirname, 'webview/index.html'),
            output: {
                entryFileNames: 'assets/main.js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith('.css')) {
                        return 'assets/main.css';
                    }
                    return 'assets/[name][extname]';
                },
            },
        },
    },
    root: path.resolve(__dirname, 'webview'),
});
