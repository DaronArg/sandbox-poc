import { defineConfig } from '@playwright/test';

// E2E de la app Electron (sin empaquetar). Requiere backend :9090, imagen assessment-runtime:poc y upstream git listos.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 10 * 60 * 1000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
});
