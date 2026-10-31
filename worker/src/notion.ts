/**
 * Cliente mínimo da API do Notion (workspace próprio do Cubodex). Bancos e colunas esperados:
 * - Produtos: Nome (título), ID (texto, ex.: i1, m3, k2), Preço (número), Disponíveis (número),
 *   Ativo no site (caixa), Pré-venda (caixa), Fotos (arquivos e mídia, opcional).
 * - Pedidos: Serial (título), Status (seleção), Cliente, Itens, Frete, Endereço, Pagamento MP (textos),
 *   E-mail (e-mail), Total (número), Data (data).
 * - Avisos: E-mail (título), Inscrito em (data), Consentimento (texto), Token (texto), Saiu (caixa).
 */
import { type ItemSpec, type ProductDef, parseDef, parseItemSpec } from '../../src/domain/catalog';
import type { PaymentStatus } from '../../src/domain/shipping';
import type { StockRow } from '../../src/domain/stock';

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

type Fetch = typeof fetch;
type Prop = {
  number?: number | null;
  checkbox?: boolean;
  rich_text?: { plain_text: string }[];
  title?: { plain_text: string }[];
  select?: { name: string } | null;
  files?: { name: string; file?: { url: string }; external?: { url: string } }[];
};

/** O que a linha descreve (Tipo, Cor, Raridade…), ainda sem validar: quem valida é `parseDef` do domínio. */
const rowDef = (p: Record<string, Prop>, name: string, created: string | undefined) => {
  const note = plain(p.Nota);
  switch (p.Tipo?.select?.name) {
    case 'carta':
      return {
        kind: 'item',
        tcgdex: plain(p['Carta TCGdex']),
        lang: p.Idioma?.select?.name,
        variant: p.Variante?.select?.name ?? plain(p.Variante),
        grade: plain(p.Gradação),
        created,
      };
    case 'miniatura':
      return { kind: 'mini', name, n: p.Número?.number, rar: p.Raridade?.select?.name, color: plain(p.Cor) };
    case 'peça':
      return {
        kind: 'craft',
        name,
        note,
        spec: [
          ['material', plain(p.Material)],
          ['medidas', plain(p.Medidas)],
          ['impressão', plain(p.Impressão)],
        ].filter(([, v]) => v),
      };
    case 'acessório':
      return { kind: 'acc', name, note };
    case 'pack':
      return { kind: 'acc', name, note, group: 'pack' };
    case 'pacote':
      return { kind: 'pack', discount: p['Desconto do pacote']?.number };
    default:
      return null;
  }
};
type Page = { id: string; created_time?: string; properties: Record<string, Prop> };

/** Erros só com status e código: o corpo do Notion pode repetir dados do cliente (e-mail, endereço). */
const failure = async (res: Response, what: string) => {
  const code = ((await res.json().catch(() => ({}))) as { code?: string }).code ?? '';
  return new Error(`Notion ${what}: ${res.status}${code ? ` ${code}` : ''}`);
};

const call = async (f: Fetch, token: string, path: string, method: string, body: unknown, what: string) => {
  const res = await f(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Sem resposta em 8 s, desiste: o Mercado Pago reenvia o aviso e o cliente não fica preso no checkout.
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw await failure(res, what);
  return (await res.json()) as Record<string, unknown>;
};

/** Todas as páginas da consulta (o Notion devolve no máximo 100 por vez). */
const query = async (f: Fetch, token: string, db: string, filter: unknown, what: string) => {
  const pages: Page[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const data = await call(
      f,
      token,
      `/databases/${db}/query`,
      'POST',
      { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) },
      what,
    );
    pages.push(...(data.results as Page[]));
    if (!data.has_more) break;
    cursor = data.next_cursor as string;
  }
  return pages;
};

const rich = (content: string) => ({ rich_text: content ? [{ text: { content: content.slice(0, 2000) } }] : [] });
const title = (content: string) => ({ title: [{ text: { content: content.slice(0, 2000) } }] });
const plain = (p?: Prop) =>
  (p?.rich_text ?? p?.title ?? [])
    .map((t) => t.plain_text)
    .join('')
    .trim();

/** O que fica no D1: a descrição pronta, ou (carta) só o que o Notion diz, sem a carta do TCGdex. */
export type StoredDef = Exclude<ProductDef, { kind: 'item' }> | ItemSpec;

export const parseStoredDef = (v: unknown): StoredDef | null =>
  (v as { kind?: string } | null)?.kind === 'item' ? parseItemSpec(v) : (parseDef(v) as StoredDef | null);

/** Um arquivo da coluna Fotos: `internal` = enviado ao Notion (o link expira e tem assinatura na query). */
export interface PhotoFile {
  name: string;
  url: string;
  internal: boolean;
}

/** Cada linha do banco Produtos, casando pela coluna ID; `pageId` serve para gravar o estoque de volta. */
export const fetchProducts = async (
  f: Fetch,
  token: string,
  db: string,
): Promise<(Omit<StockRow, 'def'> & { def?: StoredDef; pageId: string; files: PhotoFile[] })[]> =>
  (await query(f, token, db, null, 'ler produtos'))
    .map(({ id: pageId, created_time, properties: p }) => ({
      id: plain(p.ID),
      pageId,
      def: parseStoredDef(rowDef(p, plain(p.Nome), created_time)) ?? undefined,
      files: (p.Fotos?.files ?? []).flatMap((x) => {
        const url = x.file?.url ?? x.external?.url;
        return url ? [{ name: x.name, url, internal: !!x.file }] : [];
      }),
      price: p.Preço?.number ?? null,
      available: p.Disponíveis?.number ?? null,
      active: p['Ativo no site']?.checkbox ?? true,
      presale: p['Pré-venda']?.checkbox ?? false,
    }))
    .filter((row) => row.id);

/** Preço e estoque de cada produto do banco Produtos (sem o id da página). */
export const fetchStock = async (f: Fetch, token: string, db: string): Promise<StockRow[]> =>
  (await fetchProducts(f, token, db)).map(({ pageId: _page, files: _files, def, ...row }) => ({
    ...row,
    // Sem o banco não há enciclopédia para completar a carta: só as descrições que já vêm inteiras.
    ...(def && def.kind !== 'item' ? { def } : {}),
  }));

/** Grava o estoque que o D1 já baixou na coluna Disponíveis da página do produto. */
export const setAvailable = (f: Fetch, token: string, pageId: string, qty: number) =>
  call(f, token, `/pages/${pageId}`, 'PATCH', { properties: { Disponíveis: { number: qty } } }, 'gravar estoque');

/**
 * Baixa o estoque das cartas de um pedido pago: uma consulta aos produtos e um PATCH por carta (cabe no limite de
 * subrequests). `onEach` registra o progresso; `from` retoma de onde um aviso anterior parou.
 * Devolve as cartas que não tinham estoque suficiente (venda acima do estoque: a loja precisa reembolsar).
 */
export const decrementStock = async (
  f: Fetch,
  token: string,
  db: string,
  items: { id: string; qty: number }[],
  from: number,
  onEach: (done: number) => Promise<unknown>,
) => {
  if (from >= items.length) return [];
  const byId = new Map(
    (await query(f, token, db, null, 'ler produtos')).map((p) => [plain(p.properties.ID), p] as const),
  );
  const short: string[] = [];
  for (let i = from; i < items.length; i++) {
    const { id, qty } = items[i];
    const page = byId.get(id);
    const available = page?.properties.Disponíveis?.number;
    if (page && available != null) {
      if (available < qty) short.push(id);
      await call(
        f,
        token,
        `/pages/${page.id}`,
        'PATCH',
        { properties: { Disponíveis: { number: Math.max(0, available - qty) } } },
        'baixar estoque',
      );
    }
    await onEach(i + 1);
  }
  return short;
};

export interface OrderRecord {
  serial: string;
  status: PaymentStatus | 'Novo' | 'Falhou';
  customer: string;
  email: string;
  items: string;
  shipping: string;
  address: string;
  total: number;
}

export const createOrderPage = (f: Fetch, token: string, db: string, o: OrderRecord, now = new Date()) =>
  call(
    f,
    token,
    '/pages',
    'POST',
    {
      parent: { database_id: db },
      properties: {
        Serial: title(o.serial),
        Status: { select: { name: o.status } },
        Cliente: rich(o.customer),
        'E-mail': { email: o.email },
        Itens: rich(o.items),
        Frete: rich(o.shipping),
        Endereço: rich(o.address),
        Total: { number: o.total },
        Data: { date: { start: now.toISOString() } },
      },
    },
    'criar pedido',
  );

export const findOrderPage = async (f: Fetch, token: string, db: string, serial: string) => {
  const [page] = await query(f, token, db, { property: 'Serial', title: { equals: serial } }, 'achar pedido');
  return page ? { id: page.id, status: page.properties.Status?.select?.name ?? '' } : null;
};

export const updatePaymentStatus = (
  f: Fetch,
  token: string,
  pageId: string,
  status: PaymentStatus | 'Sem estoque',
  payment: string,
) =>
  call(
    f,
    token,
    `/pages/${pageId}`,
    'PATCH',
    { properties: { Status: { select: { name: status } }, 'Pagamento MP': rich(payment) } },
    'atualizar pagamento',
  );

/** Inscreve na lista de avisos; e-mail que já está lá (e não saiu) não é duplicado. */
export const addSubscriber = async (
  f: Fetch,
  token: string,
  db: string,
  s: { email: string; consent: string; token: string },
  now = new Date(),
) => {
  const [existing] = await query(f, token, db, { property: 'E-mail', title: { equals: s.email } }, 'achar inscrito');
  if (existing && !existing.properties.Saiu?.checkbox) return;
  if (existing)
    return call(
      f,
      token,
      `/pages/${existing.id}`,
      'PATCH',
      { properties: { Saiu: { checkbox: false } } },
      'reinscrever',
    );
  return call(
    f,
    token,
    '/pages',
    'POST',
    {
      parent: { database_id: db },
      properties: {
        'E-mail': title(s.email),
        'Inscrito em': { date: { start: now.toISOString() } },
        Consentimento: rich(s.consent),
        Token: rich(s.token),
        Saiu: { checkbox: false },
      },
    },
    'inscrever',
  );
};

/** Sai da lista pelo token do link do e-mail; false se o token não existe. */
export const removeSubscriber = async (f: Fetch, token: string, db: string, unsubscribeToken: string) => {
  const [page] = await query(
    f,
    token,
    db,
    { property: 'Token', rich_text: { equals: unsubscribeToken } },
    'achar token',
  );
  if (!page) return false;
  await call(f, token, `/pages/${page.id}`, 'PATCH', { properties: { Saiu: { checkbox: true } } }, 'sair da lista');
  return true;
};
