import { defineConfig } from 'vitest/config';

// Config enxuta para o Stryker: só testes de unidade do domínio, sem projetos.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
