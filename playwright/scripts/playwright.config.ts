import { defineConfig } from '@playwright/test';

// Auto-generado por la app para que los scripts grabados por codegen
// (con nombres tipo flujo_YYYYMMDD_HHMM.ts) sean reconocidos como tests.
// NOTA: el modo headless se controla desde la CLI (--headed) o via env
// PLAYWRIGHT_HEADLESS=1, NO se hardcodea aquí.
export default defineConfig({
  testMatch: ['**/*.ts'],
  testIgnore: ['**/playwright.config.ts'],
  reporter: 'line',
  fullyParallel: false,
  workers: 1,
  use: {
    viewport: { width: 1920, height: 1080 },
  },
  timeout: 120_000,
});
