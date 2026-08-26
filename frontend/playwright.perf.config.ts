import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './perf',
  timeout: 120_000,
  use: { baseURL: process.env.PERF_FRONTEND_URL ?? 'http://127.0.0.1:5174', browserName: 'chromium' },
});
