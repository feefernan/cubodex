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
  makeSerial,
  OrderError,
  parseAddress,
  SERIAL_PATTERN,
  type ValidOrder,
  validateOrder,
} from '../../src/domain/order';
import { nextOrderStatus, pickShippingOptions, shippingDays, shippingLabel } from '../../src/domain/shipping';
import { applyStock, type StockRow } from '../../src/domain/stock';
import { cepDigits, isEmail } from '../../src/domain/validation';
import { accountRoutes, currentUser } from './account-routes';
import { markOrderPaid, markOrderStatus, recordOrder, userVault } from './accounts';
import type { Ctx, Env } from './env';
import { handleError, json, limited, log, notice, readJson, unavailable } from './http';
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

export type { Env } from './env';

/** Texto do aceite da lista de avisos; vai junto com a inscrição no Notion (prova do consentimento). */
export const SUBSCRIBE_CONSENT = 'Aceito receber avisos de lançamento da Cubodex. Posso sair da lista quando quiser.';

// Catálogo do Notion em memória por 1 minuto: protege o limite de ~3 req/s do Notion e responde rápido.
let stockCache: { at: number; rows: StockRow[] } | null = null;
export const clearStockCache = () => {
  stockCache = null;
};

/** Lê preço e estoque do banco Produtos (com cache) e aplica ao catálogo usado pelas regras do domínio. */
const loadStock = async (env: Env, f: typeof fetch): Promise<StockRow[]> => {
  if (!env.NOTION_TOKEN || !env.NOTION_PRODUCTS_DB) return [];
  if (!stockCache || Date.now() - stockCache.at > 60_000) {
    const rows = await fetchStock(f, env.NOTION_TOKEN, env.NOTION_PRODUCTS_DB);
    const unknown = applyStock(rows);
    if (unknown.length) log('warn', 'produtos do Notion sem par no catálogo', { ids: unknown });
    stockCache = { at: Date.now(), rows };
  }
  return stockCache.rows;
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
    throw new OrderError(503, 'Frete ainda não está ligado. Tente mais tarde.');
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
  if (!env.NOTION_TOKEN || !env.NOTION_ORDERS_DB) return unavailable('O registro de pedidos');
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

    // A cobrança vem antes do Notion: se ela falhar, nenhum pedido "aguardando" fica órfão.
    const checkoutUrl = env.MP_ACCESS_TOKEN
      ? await createCheckout(f, env.MP_ACCESS_TOKEN, {
          serial,
          title: `Cubodex — ${count === 1 ? order.lines[0].name : `${count} itens`}`.slice(0, 200),
          goods: order.goods,
          shipping: shipping?.price ?? 0,
          payer: order.customer,
          siteUrl: env.SITE_URL,
          items: order.lines.map((l) => ({ id: l.id, qty: l.qty })),
        })
      : null;
    const status = checkoutUrl ? 'Aguardando pagamento' : 'Novo';

    // Espelho na conta antes do Notion: se o D1 falhar, não fica pedido no painel sem o cofre ligado a ele.
    if (env.DB)
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
      });

    await createOrderPage(f, env.NOTION_TOKEN, env.NOTION_ORDERS_DB, {
      serial,
      status,
      customer: order.customer.name,
      email: order.customer.email,
      items: order.lines.map(describeLine).join('\n'),
      shipping: shipping ? `${shipping.label} · R$ ${shipping.price.toFixed(2)}` : 'sem envio (cofre)',
      address: addressText(order.address),
      total,
    });
    log('info', 'pedido criado', { serial, total, cobranca: !!checkoutUrl });
    return json({ serial, total, checkoutUrl }, 201);
  } catch (e) {
    return handleError(e, 'pedido');
  }
};

/** POST /api/mp/webhook — o Mercado Pago avisa de um pagamento; o pedido no Notion acompanha. */
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

  // Erro aqui devolve 500 e o Mercado Pago reenvia o aviso. Repetir é seguro: só regrava o mesmo status.
  try {
    const payment = await getPayment(f, env.MP_ACCESS_TOKEN, dataId);
    const serial = payment.external_reference ?? '';
    const page = SERIAL_PATTERN.test(serial)
      ? await findOrderPage(f, env.NOTION_TOKEN, env.NOTION_ORDERS_DB, serial)
      : null;
    if (!page) {
      log('warn', 'pagamento sem pedido', { payment: payment.id, serial });
      return new Response(null, { status: 200 });
    }
    const status = nextOrderStatus(page.status, payment.status);
    if (status) await updatePaymentStatus(f, env.NOTION_TOKEN, page.id, status, `${payment.id} · ${payment.status}`);
    // Conta: compra paga põe os itens no cofre; envio pago tira do cofre. Idempotente no D1.
    if (env.DB && status === 'Pago') await markOrderPaid(env.DB, serial);
    if (env.DB && status === 'Cancelado') await markOrderStatus(env.DB, serial, status);
    // Só na passagem para Pago (aviso repetido não chega aqui): baixa o estoque das cartas.
    if (status === 'Pago' && env.NOTION_PRODUCTS_DB) {
      for (const item of payment.metadata?.items ?? []) {
        const qty = Number(item.qty);
        if (typeof item.id === 'string' && /^i\d+$/.test(item.id) && Number.isInteger(qty) && qty > 0)
          await decrementStock(f, env.NOTION_TOKEN, env.NOTION_PRODUCTS_DB, item.id, qty);
      }
      clearStockCache();
    }
    log('info', 'aviso de pagamento', { serial, payment: payment.id, mp: payment.status, status: status ?? 'mantido' });
    return new Response(null, { status: 200 });
  } catch (e) {
    log('error', 'webhook do pagamento falhou', { dataId, error: String(e) });
    return new Response(null, { status: 500 });
  }
};

/** GET /api/orders/:serial/status — só o status, para a página de volta do pagamento. */
const orderStatus = async (request: Request, serial: string, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.QUOTES_LIMITER);
  if (blocked) return blocked;
  if (!env.NOTION_TOKEN) return unavailable('A consulta de pedidos');
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
 * itens guardados. O pagamento confirmado (webhook) muda os itens para "envio".
 */
const shipVault = async (request: Request, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.ORDERS_LIMITER);
  if (blocked) return blocked;
  const user = await currentUser(request, env);
  if (!user || !env.DB) return json({ error: 'Entre na sua conta.' }, 401);
  if (!env.MP_ACCESS_TOKEN || !env.NOTION_TOKEN) return unavailable('O envio do cofre');
  try {
    const input = await readJson(request);
    const ids = Array.isArray(input.items)
      ? input.items.filter((i): i is string => typeof i === 'string').slice(0, 50)
      : [];
    const items = await userVault(env.DB, user.id, ids);
    if (!items.length || items.length !== ids.length)
      throw new OrderError(409, 'Algum item já saiu do cofre. Atualize a página.');
    const address = parseAddress(input.address);
    if (!address) throw new OrderError(400, 'Endereço de entrega incompleto.');
    const lines = items.map((it) => {
      const p = productById[it.product_id];
      return { id: it.product_id, kind: p?.kind ?? 'item', qty: it.qty, price: p?.price ?? 0 } as CartLine;
    });
    const options = await quoteFor(env, f, address.cep, lines);
    const chosen = options.find((o) => o.id === Number((input.shipping as { serviceId?: unknown })?.serviceId));
    if (!chosen) throw new OrderError(409, 'Essa opção de frete mudou. Calcule o frete de novo.');
    const serial = makeSerial(new Date(), crypto.getRandomValues(new Uint8Array(6)));
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
    await recordOrder(env.DB, {
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
      customer: user.name,
      email: user.email,
      items: `ENVIO DO COFRE\n${summary.replaceAll('; ', '\n')}`,
      shipping: `${label} · R$ ${chosen.price.toFixed(2)}`,
      address: addressText(address),
      total: chosen.price,
    });
    log('info', 'envio do cofre criado', { serial, itens: items.length });
    return json({ serial, total: chosen.price, checkoutUrl }, 201);
  } catch (e) {
    return handleError(e, 'envio do cofre');
  }
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** POST /api/avisos — { email, consent: true } → entra na lista de avisos de lançamento. */
const subscribe = async (request: Request, env: Env, f: typeof fetch) => {
  const blocked = await limited(request, env.QUOTES_LIMITER);
  if (blocked) return blocked;
  if (!env.NOTION_TOKEN || !env.NOTION_SUBSCRIBERS_DB) return unavailable('A lista de avisos');
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

/** GET /api/avisos/sair?t=<token> — link de saída que vai em todo e-mail da lista. */
const unsubscribe = async (url: URL, env: Env, f: typeof fetch) => {
  const token = url.searchParams.get('t') ?? '';
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

export const handle = async (request: Request, env: Env, _ctx: Ctx, f: typeof fetch = fetch): Promise<Response> => {
  const url = new URL(request.url);
  const { method } = request;
  const path = url.pathname;
  if (path === '/api/health') return json({ ok: true });
  if (path === '/api/catalog' && method === 'GET') return catalog(env, f);
  if (path === '/api/shipping/quote' && method === 'POST') return shippingQuote(request, env, f);
  if (path === '/api/orders' && method === 'POST') return createOrder(request, env, f);
  if (path === '/api/mp/webhook' && method === 'POST') return paymentWebhook(request, env, f);
  if (path === '/api/avisos' && method === 'POST') return subscribe(request, env, f);
  if (path === '/api/avisos/sair' && method === 'GET') return unsubscribe(url, env, f);
  if (path === '/api/vault/ship' && method === 'POST') return shipVault(request, env, f);
  const account = await accountRoutes(request, env, path);
  if (account) return account;
  const status = path.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (status && method === 'GET') return orderStatus(request, status[1], env, f);
  return json({ error: 'Não encontrado' }, 404);
};
