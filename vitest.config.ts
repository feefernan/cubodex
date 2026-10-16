import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'jsdom' },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      // Catraca: só sobe. Hoje ~ lines 98, statements 97, functions 99, branches 88.
      thresholds: { lines: 97, functions: 97, branches: 85, statements: 95 },
    },
  },
});
