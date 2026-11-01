import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'worker', include: ['tests/worker/**/*.test.ts'], environment: 'node' } },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'jsdom' },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'worker/src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.d.ts', 'worker/src/entry.ts'],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      // Catraca: só sobe. Hoje ~ lines 99, statements 98, functions 99, branches 91.
      thresholds: { lines: 98, functions: 98, branches: 90, statements: 97 },
    },
  },
});
