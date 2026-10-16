import { type Env, handle } from './app';

// Só /api/* chega aqui (assets.runWorkerFirst); o resto é o site estático.
// Confere que o Env local de app.ts é compatível com os tipos gerados a partir de cloudflare.config.ts.
const typed: ExportedHandler<Env> = { fetch: (request, env, ctx) => handle(request, env, ctx) };

export default typed satisfies ExportedHandler<Cloudflare.Env>;
