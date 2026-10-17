import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from './worker/src/entry.ts' with { type: 'cf-worker' };

// Site (build do Vite) + API /api/* no mesmo Worker, na conta própria do Cubodex.
// A conta vem de CLOUDFLARE_ACCOUNT_ID no CI — nunca a conta do Hortelã.
export default defineConfig({
  worker: {
    name: 'cubodex',
    compatibilityDate: '2026-10-12',
    entrypoint,
    // shortcut: endereço provisório *.workers.dev até ter domínio próprio (#22).
    workersDev: true,
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*'] },
    observability: { enabled: true, logs: { enabled: true } },
    env: {
      SITE_URL: bindings.text('https://cubodex.contato-3dcubo.workers.dev'),
      CONTACT_EMAIL: bindings.text('contato@cubodex.com.br'),
      // IDs dos bancos do Notion do Cubodex (preencher ao criar o workspace; vazio = rota responde 503).
      NOTION_PRODUCTS_DB: bindings.text('3fc620acc67f81ce91b8c6174dbc0c83'),
      NOTION_ORDERS_DB: bindings.text('3fc620acc67f81c4b79ee5e7e37d9183'),
      NOTION_SUBSCRIBERS_DB: bindings.text('3fc620acc67f81d5868dda267d60041d'),
      // Cotar no Melhor Envio é gratuito; só a compra de etiqueta é cobrada.
      MELHOR_ENVIO_API: bindings.text('https://melhorenvio.com.br'),
      // CEP de onde as peças saem (#21); vazio = frete desligado.
      ORIGIN_CEP: bindings.text('01403020'),
      NOTION_TOKEN: bindings.secret(),
      MELHOR_ENVIO_TOKEN: bindings.secret(),
      MP_ACCESS_TOKEN: bindings.secret(),
      MP_WEBHOOK_SECRET: bindings.secret(),
      // Contas (#29): Dex, cofre e pedidos. O CI cria o banco e aplica worker/migrations antes do deploy.
      DB: bindings.d1({ name: 'cubodex-db' }),
      // Link de login por e-mail (Cloudflare Email Service). Precisa de domínio verificado (#22);
      // EMAIL_FROM vazio = login desligado em produção (em localhost o link vai para o log).
      EMAIL: bindings.sendEmail(),
      EMAIL_FROM: bindings.text(''),
      // 5 pedidos por minuto por IP: suficiente para quem compra, freia spam.
      ORDERS_LIMITER: bindings.rateLimit({ namespace: '2001', simple: { limit: 5, period: 60 } }),
      // Cotações, status e inscrições: o cliente pode testar alguns CEPs.
      QUOTES_LIMITER: bindings.rateLimit({ namespace: '2002', simple: { limit: 20, period: 60 } }),
    },
  },
});
