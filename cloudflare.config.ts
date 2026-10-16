import { defineConfig } from 'cf/config';

// Site estático (build do Vite) servido pelo Cloudflare, na conta própria do Cubodex.
// A conta vem de CLOUDFLARE_ACCOUNT_ID no CI — nunca a conta do Hortelã.
export default defineConfig({
  worker: {
    name: 'cubodex',
    compatibilityDate: '2026-10-12',
    // shortcut: endereço provisório *.workers.dev até ter domínio próprio (#22).
    workersDev: true,
    assets: { notFoundHandling: 'single-page-application' },
  },
});
