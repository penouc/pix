import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  root: path.resolve(__dirname),
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              // Keep Pi SDK + native deps out of the bundle (plan §7.2 packaging).
              external: [
                'electron',
                'electron-updater',
                'node:sqlite',
                'node:fs',
                'node:path',
                'node:crypto',
                /^node:/,
                /^@earendil-works\//,
                /^@silvia-odwyer\//,
                '@pi-desktop/database',
                'diff',
                'glob',
                'jiti',
                'yaml',
                'chalk',
                'ignore',
                'semver',
                'undici',
                'typebox',
                'typescript',
                'minimatch',
                'cross-spawn',
                'node-pty',
                'highlight.js',
                'hosted-git-info',
                'proper-lockfile',
              ],
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
