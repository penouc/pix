import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      // Electron tests use the electron.launch() API from @playwright/test
      // and do not require a separate browser configuration.
      testMatch: '**/*.spec.ts',
    },
  ],
  // Require the desktop app to be built before running E2E tests.
  // Run `pnpm build` first.
  globalSetup: path.join(root, 'tests/e2e/setup.ts'),
});
