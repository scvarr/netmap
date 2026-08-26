import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/health': {
        target: 'http://backend:8000',
        rewrite: () => '/health',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['perf/**', '**/node_modules/**', '**/dist/**'],
  },
});
