/**
 * Contratos de arquitetura (arch-contract). Camadas:
 *   domain/ → regras puras (sem DOM, sem I/O). Não importa ninguém fora de domain.
 *   infra/  → integrações (armazenamento no navegador). Pode importar domain.
 *   ui/     → DOM e interação. Pode importar domain e infra.
 *   main.ts → composição (bootstrap).
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-e-puro',
      severity: 'error',
      comment: 'domain/ não pode depender de infra/ nem de ui/.',
      from: { path: '^src/domain' },
      to: { path: '^src/(infra|ui)' },
    },
    {
      name: 'infra-nao-conhece-ui',
      severity: 'error',
      comment: 'infra/ não pode depender de ui/.',
      from: { path: '^src/infra' },
      to: { path: '^src/ui' },
    },
    {
      name: 'worker-so-usa-dominio',
      severity: 'error',
      comment: 'worker/ (API da loja) só pode reaproveitar src/domain/ — nada de DOM, ui/ ou infra/ do site.',
      from: { path: '^worker/src' },
      to: { path: '^src/(?!domain/)' },
    },
    {
      name: 'ninguem-importa-main',
      severity: 'error',
      from: {},
      to: { path: '^src/main\\.ts$' },
    },
    {
      name: 'sem-ciclos',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sem-orfaos',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)tsconfig\\.json$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  },
};
