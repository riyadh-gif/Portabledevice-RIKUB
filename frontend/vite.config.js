import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build the React SPA into ../web, served by Flask (app.py) to the pywebview.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: '../web',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 700,
  },
});
