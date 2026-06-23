import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const fsAllow = uniqueExistingPaths([
  packageRoot,
  cwd,
  resolve(packageRoot),
  resolve(cwd),
  safeRealpath(packageRoot),
  safeNativeRealpath(packageRoot),
  safeRealpath(cwd),
  safeNativeRealpath(cwd)
]);

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules/echarts')) return 'echarts';
          return null;
        }
      }
    },
    chunkSizeWarningLimit: 1500
  },
  server: {
    fs: {
      allow: fsAllow
    },
    watch: {
      ignored: ['**/data/**', '**/.git/**', '**/node_modules/**']
    },
    proxy: {
      '/api': `http://127.0.0.1:${process.env.API_PORT || 4173}`
    }
  }
});

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function safeNativeRealpath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function uniqueExistingPaths(paths) {
  return [...new Set(paths.filter(Boolean).map(path => path.replace(/\\/g, '/')))];
}
