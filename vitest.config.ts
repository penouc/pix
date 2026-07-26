import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'packages/**/*.{test,spec}.ts',
      'apps/**/*.{test,spec}.ts',
      'tests/**/*.{test,spec}.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/e2e/**',
    ],
    coverage: {
      reporter: ['text', 'html'],
      include: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.{ts,tsx}'],
    },
  },
});
