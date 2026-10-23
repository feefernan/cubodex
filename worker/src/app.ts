/**
 * API da loja Cubodex (mesma origem do site, em /api/*). Cota o frete (Melhor Envio), recebe o pedido, valida e
 * recalcula no servidor, cria a cobrança no Mercado Pago, grava no Notion e acompanha o pagamento; lista de avisos.
 *
 * Tipos mínimos e locais (em vez dos gerados pelo cf) para o mesmo código ser checado e testado pelo
 * TypeScript/Vitest da raiz; `entry.ts` confere que eles batem com os tipos gerados.
 */
import { type CartLine, resolveCart } from '../../src/domain/cart';
import { productById } from '../../src/domain/catalog';
import {
  describeLine,
  MAX_LINES,
  makeSerial,
  OrderError,
  parseAddress,
  SERIAL_PATTERN,
  type ValidOrder,
  validateOrder,
} from '../../src/domain/order';
import {
  nextOrderStatus,
  type PaymentStatus,
  pickShippingOptions,
  shippingDays,
  shippingLabel,
} from '../../src/domain/shipping';
import { applyStock, PHOTO_KEY, type StockRow } from '../../src/domain/stock';
import { cepDigits, formatCpf, formatPhone, isCpf, isEmail, isPhone } from '../../src/domain/validation';
import { accountRoutes, currentUser } from './account-routes';
import {
  applyVaultEffects,
  claimPaid,
  getOrder,
  markOrderStatus,
  markRefunded,
  recordOrder,
  releaseShipment,
  reserveForShipment,
  setStockDone,
} from './accounts';
import { flushStock, readProducts, refreshCatalog, takeStock } from './catalog-db';
import type { Ctx, Env } from './env';
import { handleError, json, limited, log, notice, page, readJson, unavailable } from './http';
import { quoteShipping } from './melhor-envio';
import { createCheckout, getPayment, verifySignature } from './mercado-pago';
import {
  addSubscriber,
  createOrderPage,
  decrementStock,
  fetchStock,
  findOrderPage,
  removeSubscriber,
  updatePaymentStatus,
} from './notion';
import { tcgRoutes } from './tcg';

export { refreshCatalog } from './catalog-db';

/** Cron (a cada 10 minutos): grava no Notion as baixas de estoque pendentes e traz de lá o que o dono editou. */
export const scheduled = (env: Env, ctx: Ctx, f: typeof fetch = fetch) => {
  if (env.DB) ctx.waitUntil(refreshCatalog(env.DB, env, f));
};
export type { Env } from './env';

/** Texto do aceite da lista de avisos; vai junto com a inscrição no Notion (prova do consentimento). */
export const SUBSCRIBE_CONSENT = 'Aceito receber avisos de lançamento da Cubodex. Posso sair da lista quando quiser.';

// Catálogo do Notion em memória por 1 minuto: protege o limite de ~3 req/s do Notion e responde rápido.
let stockCache: { at: number; rows: StockRow[] } | null = null;
export const clearStockCache = () => {
  stockCache = null;
};

/**
 * Lê preço e estoque e aplica ao catálogo usado pelas regras do domínio. Com banco, vem do D1 (o cron o mantém
 * igual ao Notion; na primeira vez, com a tabela vazia, busca do Notion uma vez). Sem banco (desenvolvimento),
 * vem direto do Notion, com cache de 1 minuto para respeitar o limite de ~3 req/s.
 */
const loadStock = async (env: Env, f: typeof fetch): Promise<StockRow[]> => {
  if (!env.NOTION_TOKEN || !env.NOTION_PRODUCTS_DB) return [];
  if (env.DB) {
    let rows = await readProducts(env.DB);
    if (!rows.length && (await refreshCatalog(env.DB, env, f))) rows = await readProducts(env.DB);
    const unknown = applyStock(rows);
    if (unknown.length) log('warn', 'produtos do Notion sem par no catálogo', { ids: unknown });
    return rows;
  }
  if (!stockCache || Date.now() - stockCache.at > 60_000) {
    const rows = await fetchStock(f, env.NOTION_TOKEN, env.NOTION_PRODUCTS_DB);
    const unknown = applyStock(rows);
    if (unknown.length) log('warn', 'produtos do Notion sem par no catálogo', { ids: unknown });
    stockCache = { at: Date.now(), rows };
  }
  return stockCache.rows;
};

/**
 * GET /api/img/fotos/<id>/<hash>.<ext> — foto de produto do R2. A chave tem o hash do arquivo: foto trocada é outra
 * chave, então a resposta nunca muda e o navegador e a borda guardam por 1 ano (cada leitura que o cache evita é
 * uma chamada a menos do Worker e do R2).
 */
const photo = async (request: Request, env: Env, key: string, ctx: Ctx) => {
  if (!PHOTO_KEY.test(key)) return json({ error: 'Não encontrado' }, 404);
  const cache = typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default;
  const hit = await cache?.match(request);
  if (hit) return hit;
  const obj = await env.FOTOS?.get(key);
  if (!obj?.body) return json({ error: 'Não encontrado' }, 404);
  const res = new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  if (cache) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
};

/** GET /api/catalog — preço e estoque atuais; lista vazia = o site segue com o catálogo do código. */
const catalog = async (env: Env, f: typeof fetch) => {
  try {
    const rows = await loadStock(env, f);
    return json({ products: rows }, 200, { 'Cache-Control': 'public, max-age=60' });
  } catch (e) {
    return handleError(e, 'catálogo do Notion');
  }
};

const quoteFor = async (env: Env, f: typeof fetch, cep: string, lines: CartLine[]) => {
  if (!env.MELHOR_ENVIO_TOKEN || !env.ORIGIN_CEP)
    throw new OrderError(503, 'O cálculo de frete não está disponível agora. Tente mais tarde.');
  const options = await quoteShipping(f, { ...env, MELHOR_ENVIO_TOKEN: env.MELHOR_ENVIO_TOKEN }, cep, lines);
  if (!options.length) throw new OrderError(422, 'Nenhuma opção de envio para esse CEP');
  return options;
};

/** POST /api/shipping/quote — { cep, items } → opções de frete para o que vai ser enviado agora. */
const shippingQuote = async (request: Request, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.QUOTES_LIMITER);
  if (blocked) return blocked;
  try {
    const input = await readJson(request);
    const cep = cepDigits(String(input.cep ?? ''));
    if (cep.length !== 8) throw new OrderError(400, 'CEP inválido');
    await loadStock(env, f);
    const { lines } = resolveCart(Array.isArray(input.items) ? (input.items as never) : []);
    const shipLines = lines.filter((l) => l.dest !== 'vault');
    if (!shipLines.length) throw new OrderError(400, 'Nada para enviar');
    const options = await quoteFor(env, f, cep, shipLines);
    return json({ options: pickShippingOptions(options) });
  } catch (e) {
    return handleError(e, 'cotação de frete');
  }
};

/** Frete recotado no servidor: o preço que o navegador mostrou nunca é usado. */
const chosenShipping = async (order: ValidOrder, env: Env, f: typeof fetch) => {
  if (!order.address) return null;
  const options = await quoteFor(env, f, order.address.cep, order.shipLines);
  const chosen = options.find((o) => o.id === order.serviceId);
  if (!chosen) throw new OrderError(409, 'Essa opção de frete mudou. Calcule o frete de novo.');
  return { label: `${shippingLabel(chosen)} · ${shippingDays(chosen.days)}`, price: chosen.price };
};

const addressText = (a: ValidOrder['address']) =>
  a
    ? `${a.street}, ${a.number}${a.complement ? ` ${a.complement}` : ''} — ${a.district} — ${a.city}/${a.uf} — CEP ${a.cep}`
    : 'tudo no cofre';

/** POST /api/orders — valida, recalcula, cobra (Mercado Pago) e grava no Notion. */
const createOrder = async (request: Request, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.ORDERS_LIMITER);
  if (blocked) return blocked;
  // Sem Mercado Pago não há como cobrar: melhor recusar do que criar pedido "pago por ninguém" (#39).
  if (!env.NOTION_TOKEN || !env.NOTION_ORDERS_DB || !env.MP_ACCESS_TOKEN) return unavailable();
  let mirrored: string | null = null;
  try {
    const input = await readJson(request);
    await loadStock(env, f);
    const user = await currentUser(request, env);
    // Guardar no cofre exige conta: o item fica ligado a quem comprou.
    const order = validateOrder(input, { vaultAllowed: !!user });
    const shipping = await chosenShipping(order, env, f);
    const total = Math.round((order.goods + (shipping?.price ?? 0)) * 100) / 100;
    const serial = makeSerial(new Date(), crypto.getRandomValues(new Uint8Array(6)));
    const count = order.lines.reduce((a, l) => a + l.qty, 0);
    // Só cartas têm estoque contado; pacotes e peças impressas não.
    const stock = order.lines.filter((l) => l.kind === 'item').map((l) => ({ id: l.id, qty: l.qty }));

    // A cobrança vem antes de qualquer registro: se ela falhar, nenhum pedido "aguardando" fica órfão.
    const checkoutUrl = await createCheckout(f, env.MP_ACCESS_TOKEN, {
      serial,
      title: `Cubodex — ${count === 1 ? order.lines[0].name : `${count} itens`}`.slice(0, 200),
      goods: order.goods,
      shipping: shipping?.price ?? 0,
      payer: order.customer,
      siteUrl: env.SITE_URL,
      items: stock,
    });
    const status = 'Aguardando pagamento';

    if (env.DB) {
      await recordOrder(env.DB, {
        serial,
        userId: user?.id ?? null,
        kind: 'compra',
        status,
        total,
        summary: order.lines.map(describeLine).join('; '),
        vault: order.lines
          .filter((l) => l.dest === 'vault')
          .map((l) => ({ id: l.id, qty: l.qty, name: l.name, meta: l.sub })),
        stock,
      });
      mirrored = serial;
    }

    await createOrderPage(f, env.NOTION_TOKEN, env.NOTION_ORDERS_DB, {
      serial,
      status,
      // shortcut: sem colunas CPF/Telefone no Notion, vão junto do nome em "Cliente"; separe em colunas se o volume pedir.
      customer: `${order.customer.name} · CPF ${formatCpf(order.customer.cpf)} · ${formatPhone(order.customer.phone)}`,
      email: order.customer.email,
      items: order.lines.map(describeLine).join('\n'),
      shipping: shipping ? `${shipping.label} · R$ ${shipping.price.toFixed(2)}` : 'sem envio (cofre)',
      address: addressText(order.address),
      total,
    });
    log('info', 'pedido criado', { serial, total });
    return json({ serial, total, checkoutUrl }, 201);
  } catch (e) {
    // Gravou na conta mas não chegou ao painel: o pedido não aparece como "aguardando" para sempre.
    if (mirrored && env.DB) await markOrderStatus(env.DB, mirrored, 'Falhou').catch(() => {});
    return handleError(e, 'pedido');
  }
};

/**
 * Efeitos de um pedido pago, cada um uma vez só e retomável: estoque e cofre, ambos no D1. O estoque baixa por
 * UPDATE atômico; o Notion recebe o valor em seguida (se falhar, o cron grava depois: não derruba o aviso do pagamento).
 */
const settlePaid = async (env: Env, f: typeof fetch, serial: string) => {
  if (!env.DB) return [];
  const db = env.DB;
  const order = await getOrder(db, serial);
  if (!order) return [];
  const items = JSON.parse(order.items_json) as { id: string; qty: number }[];
  let short: string[] = [];
  if (order.stock_done < items.length) {
    short = await takeStock(db, items, order.stock_done, (n) => setStockDone(db, serial, n));
    clearStockCache();
    if (env.NOTION_TOKEN) await flushStock(db, f, env.NOTION_TOKEN).catch(() => 0);
  }
  await applyVaultEffects(db, serial, order);
  return short;
};

/**
 * POST /api/mp/webhook — o Mercado Pago avisa de um pagamento.
 * Ordem segura (#39): o D1 decide quem faz a passagem para Pago (uma vez só, mesmo com avisos simultâneos),
 * os efeitos rodam com progresso salvo e o Notion é atualizado por último. Se algo falhar, a resposta é 500, o
 * Mercado Pago reenvia e o reenvio continua de onde parou.
 */
const paymentWebhook = async (request: Request, env: Env, f: typeof fetch) => {
  if (!env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET || !env.NOTION_TOKEN) return new Response(null, { status: 503 });
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as { type?: string; data?: { id?: string | number } };
  const dataId = url.searchParams.get('data.id') ?? String(body.data?.id ?? '');
  const signed = await verifySignature(
    env.MP_WEBHOOK_SECRET,
    request.headers.get('x-signature'),
    request.headers.get('x-request-id'),
    dataId,
  );
  if (!signed) {
    log('warn', 'aviso de pagamento sem assinatura válida', {
      formato: url.searchParams.has('topic') ? 'ipn' : 'webhook',
    });
    return new Response(null, { status: 401 });
  }
  if ((url.searchParams.get('type') ?? body.type) !== 'payment') return new Response(null, { status: 200 });

  try {
    const payment = await getPayment(f, env.MP_ACCESS_TOKEN, dataId);
    const serial = payment.external_reference ?? '';
    if (!SERIAL_PATTERN.test(serial)) {
      log('warn', 'pagamento sem pedido', { payment: payment.id });
      return new Response(null, { status: 200 });
    }
    const mirror = env.DB ? await getOrder(env.DB, serial) : null;
    const page = await findOrderPage(f, env.NOTION_TOKEN, env.NOTION_ORDERS_DB, serial);
    if (!page && !mirror) {
      log('warn', 'pagamento sem pedido', { payment: payment.id, serial });
      return new Response(null, { status: 200 });
    }
    // O D1 é a fonte da verdade do status (o Notion pode estar um passo atrás depois de uma falha).
    const current = mirror?.status ?? page?.status ?? '';
    const next = nextOrderStatus(current, payment.status);
    let note = `${payment.id} · ${payment.status}`;

    let claimed = false;
    if (next === 'Pago' && env.DB) {
      claimed = await claimPaid(env.DB, serial);
      if (
        claimed &&
        mirror &&
        payment.transaction_amount != null &&
        Math.abs(payment.transaction_amount - mirror.total) > 0.01
      ) {
        log('warn', 'valor pago diferente do pedido', {
          serial,
          pago: payment.transaction_amount,
          pedido: mirror.total,
        });
        note += ` · VALOR DIVERGENTE (pago ${payment.transaction_amount}, pedido ${mirror.total})`;
      }
    }
    if (next === 'Estornado' && env.DB) await markRefunded(env.DB, serial);
    if (next === 'Cancelado' && env.DB) {
      await markOrderStatus(env.DB, serial, 'Cancelado');
      await releaseShipment(env.DB, serial);
    }

    // Com D1, só quem ganhou a passagem (ou um reenvio, com o D1 já "Pago") faz a baixa: dois avisos simultâneos
    // leem o mesmo status antigo, mas só um vence o claimPaid.
    const paid = current === 'Pago' || (env.DB ? claimed : next === 'Pago');
    let final = next ?? current;
    if (paid && final === 'Pago') {
      const short = env.DB
        ? await settlePaid(env, f, serial)
        : await settleWithoutDb(env, f, payment.metadata?.items, next === 'Pago');
      if (short.length) {
        final = 'Sem estoque';
        note += ` · SEM ESTOQUE: ${short.join(', ')} (reembolsar)`;
        log('warn', 'venda acima do estoque', { serial, cartas: short });
      }
    }
    // Notion por último: só muda quando o resto já está feito.
    // ("Sem estoque" fica marcado até alguém resolver no painel; um reenvio não o troca de volta por "Pago".)
    if (page && page.status !== final && !(page.status === 'Sem estoque' && final === 'Pago'))
      await updatePaymentStatus(f, env.NOTION_TOKEN, page.id, final as PaymentStatus | 'Sem estoque', note);
    log('info', 'aviso de pagamento', { serial, payment: payment.id, mp: payment.status, status: final });
    return new Response(null, { status: 200 });
  } catch (e) {
    log('error', 'webhook do pagamento falhou', { dataId, error: String(e) });
    return new Response(null, { status: 500 });
  }
};

/** Sem D1 (desenvolvimento sem banco): baixa o estoque só na passagem para Pago, pela lista do Mercado Pago. */
const settleWithoutDb = async (
  env: Env,
  f: typeof fetch,
  raw: { id?: unknown; qty?: unknown }[] | undefined,
  first: boolean,
) => {
  if (!first || !env.NOTION_TOKEN || !env.NOTION_PRODUCTS_DB) return [];
  const items = (raw ?? []).flatMap((it) =>
    typeof it.id === 'string' &&
    productById[it.id]?.kind === 'item' &&
    Number.isInteger(Number(it.qty)) &&
    Number(it.qty) > 0
      ? [{ id: it.id, qty: Number(it.qty) }]
      : [],
  );
  const short = await decrementStock(f, env.NOTION_TOKEN, env.NOTION_PRODUCTS_DB, items, 0, async () => {});
  clearStockCache();
  return short;
};

/** GET /api/orders/:serial/status — só o status, para a página de volta do pagamento. */
const orderStatus = async (request: Request, serial: string, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.QUOTES_LIMITER);
  if (blocked) return blocked;
  if (!env.NOTION_TOKEN) return unavailable();
  if (!SERIAL_PATTERN.test(serial)) return json({ error: 'Pedido não encontrado' }, 404);
  try {
    const page = await findOrderPage(f, env.NOTION_TOKEN, env.NOTION_ORDERS_DB, serial);
    return page ? json({ status: page.status }) : json({ error: 'Pedido não encontrado' }, 404);
  } catch (e) {
    return handleError(e, 'consulta de status');
  }
};

/**
 * POST /api/vault/ship — { items: [id do cofre], address, shipping: { serviceId } } → cobra o frete do envio dos
 * itens guardados. Os itens ficam separados para esse envio (não dá para pagar o frete deles duas vezes); o
 * pagamento confirmado (webhook) muda os itens para "envio"; recusado, eles voltam a ficar livres.
 */
const shipVault = async (request: Request, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.ORDERS_LIMITER);
  if (blocked) return blocked;
  const user = await currentUser(request, env);
  if (!user || !env.DB) return json({ error: 'Entre na sua conta.' }, 401);
  if (!env.MP_ACCESS_TOKEN || !env.NOTION_TOKEN) return unavailable();
  const db = env.DB;
  const serial = makeSerial(new Date(), crypto.getRandomValues(new Uint8Array(6)));
  let reserved = false;
  try {
    const input = await readJson(request);
    const ids = Array.isArray(input.items)
      ? [...new Set(input.items.filter((i): i is string => typeof i === 'string'))].slice(0, MAX_LINES)
      : [];
    const address = parseAddress(input.address);
    if (!address) throw new OrderError(400, 'Endereço de entrega incompleto.');
    const contact = (input.contact ?? {}) as Record<string, unknown>;
    const cpf = String(contact.cpf ?? '').replace(/\D/g, '');
    const phone = String(contact.phone ?? '').replace(/\D/g, '');
    if (!isCpf(cpf)) throw new OrderError(400, 'Digite um CPF válido.');
    if (!isPhone(phone)) throw new OrderError(400, 'Digite um telefone com DDD.');
    await loadStock(env, f);
    const items = await reserveForShipment(db, user.id, ids, serial);
    if (!items?.length)
      throw new OrderError(409, 'Algum item já saiu do cofre ou já está num envio. Atualize a página.');
    reserved = true;
    const lines = items.map((it) => {
      const p = productById[it.product_id];
      return { id: it.product_id, kind: p?.kind ?? 'item', qty: it.qty, price: p?.price ?? 0 } as CartLine;
    });
    const options = await quoteFor(env, f, address.cep, lines);
    const chosen = options.find((o) => o.id === Number((input.shipping as { serviceId?: unknown })?.serviceId));
    if (!chosen) throw new OrderError(409, 'Essa opção de frete mudou. Calcule o frete de novo.');
    const label = `${shippingLabel(chosen)} · ${shippingDays(chosen.days)}`;
    const checkoutUrl = await createCheckout(f, env.MP_ACCESS_TOKEN, {
      serial,
      title: 'Cubodex — envio do cofre',
      goods: chosen.price,
      shipping: 0,
      payer: { name: user.name, email: user.email },
      siteUrl: env.SITE_URL,
      items: [],
    });
    const summary = items.map((it) => `${it.qty}× ${it.name} (${it.meta})`).join('; ');
    await recordOrder(db, {
      serial,
      userId: user.id,
      kind: 'envio',
      status: 'Aguardando pagamento',
      total: chosen.price,
      summary,
      vault: items.map((it) => it.id),
    });
    await createOrderPage(f, env.NOTION_TOKEN, env.NOTION_ORDERS_DB, {
      serial,
      status: 'Aguardando pagamento',
      customer: `${user.name} · CPF ${formatCpf(cpf)} · ${formatPhone(phone)}`,
      email: user.email,
      items: `ENVIO DO COFRE\n${summary.replaceAll('; ', '\n')}`,
      shipping: `${label} · R$ ${chosen.price.toFixed(2)}`,
      address: addressText(address),
      total: chosen.price,
    });
    log('info', 'envio do cofre criado', { serial, itens: items.length });
    return json({ serial, total: chosen.price, checkoutUrl }, 201);
  } catch (e) {
    if (reserved) {
      await releaseShipment(db, serial).catch(() => {});
      await markOrderStatus(db, serial, 'Falhou').catch(() => {});
    }
    return handleError(e, 'envio do cofre');
  }
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** POST /api/avisos — { email, consent: true } → entra na lista de avisos de lançamento. */
const subscribe = async (request: Request, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.QUOTES_LIMITER);
  if (blocked) return blocked;
  if (!env.NOTION_TOKEN || !env.NOTION_SUBSCRIBERS_DB) return unavailable();
  try {
    const input = await readJson(request);
    const email = String(input.email ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 200);
    if (!isEmail(email)) throw new OrderError(400, 'Digite um e-mail válido.');
    if (input.consent !== true) throw new OrderError(400, 'Marque o aceite para entrar na lista.');
    const token = hex(crypto.getRandomValues(new Uint8Array(16)));
    await addSubscriber(f, env.NOTION_TOKEN, env.NOTION_SUBSCRIBERS_DB, { email, consent: SUBSCRIBE_CONSENT, token });
    return json({ ok: true }, 201);
  } catch (e) {
    return handleError(e, 'inscrição na lista');
  }
};

/**
 * GET /api/avisos/sair?t=<token> — página com botão. Verificadores de link dos e-mails abrem a URL sozinhos; se o
 * GET já descadastrasse, tirariam da lista quem não pediu. Só o POST (clique) sai da lista.
 */
const unsubscribePage = (url: URL) => {
  const token = url.searchParams.get('t') ?? '';
  if (!/^[0-9a-f]{32}$/.test(token)) return notice('Link inválido.', 400);
  return page(
    `<h1 style="font-size:24px">sair da lista de avisos</h1><p>Você deixa de receber os avisos de lançamento da Cubodex.</p><form method="post" action="/api/avisos/sair"><input type="hidden" name="t" value="${token}"><button style="font:700 16px system-ui;padding:12px 20px;border:0;border-radius:8px;background:#101419;color:#fff;cursor:pointer">sair da lista</button></form>`,
  );
};

/** POST /api/avisos/sair — formulário da página acima. */
const unsubscribe = async (request: Request, env: Env, f: typeof fetch) => {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return notice('Origem inválida.', 403);
  const token = String((await request.formData().catch(() => null))?.get('t') ?? '');
  if (!env.NOTION_TOKEN || !/^[0-9a-f]{32}$/.test(token)) return notice('Link inválido.', 400);
  try {
    return (await removeSubscriber(f, env.NOTION_TOKEN, env.NOTION_SUBSCRIBERS_DB, token))
      ? notice('Pronto: você saiu da lista de avisos da Cubodex.')
      : notice('Esse link não está mais ativo.', 404);
  } catch (e) {
    log('error', 'saída da lista falhou', { error: String(e) });
    return notice('Não deu para concluir agora. Tente de novo mais tarde.', 502);
  }
};

export const handle = async (request: Request, env: Env, ctx: Ctx, f: typeof fetch = fetch): Promise<Response> => {
  const url = new URL(request.url);
  const { method } = request;
  const path = url.pathname;
  if (path === '/api/health') return json({ ok: true });
  const tcg = await tcgRoutes(request, env, path, ctx);
  if (tcg) return tcg;
  if (path.startsWith('/api/img/') && method === 'GET') return photo(request, env, path.slice('/api/img/'.length), ctx);
  if (path === '/api/catalog' && method === 'GET') return catalog(env, f);
  if (path === '/api/shipping/quote' && method === 'POST') return shippingQuote(request, env, f);
  if (path === '/api/orders' && method === 'POST') return createOrder(request, env, f);
  if (path === '/api/mp/webhook' && method === 'POST') return paymentWebhook(request, env, f);
  if (path === '/api/avisos' && method === 'POST') return subscribe(request, env, f);
  if (path === '/api/avisos/sair' && method === 'GET') return unsubscribePage(url);
  if (path === '/api/avisos/sair' && method === 'POST') return unsubscribe(request, env, f);
  if (path === '/api/vault/ship' && method === 'POST') return shipVault(request, env, f);
  const account = await accountRoutes(request, env, path, f);
  if (account) return account;
  const status = path.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (status && method === 'GET') return orderStatus(request, status[1], env, f);
  return json({ error: 'Não encontrado' }, 404);
};
