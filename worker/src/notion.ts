/**
 * Cliente mínimo da API do Notion (workspace próprio do Cubodex). Bancos e colunas esperados:
 * - Produtos: Nome (título), ID (texto, ex.: i1, m3, k2), Preço (número), Disponíveis (número),
 *   Ativo no site (caixa), Pré-venda (caixa).
 * - Pedidos: Serial (título), Status (seleção), Cliente, Itens, Frete, Endereço, Pagamento MP (textos),
 *   E-mail (e-mail), Total (número), Data (data).
 * - Avisos: E-mail (título), Inscrito em (data), Consentimento (texto), Token (texto), Saiu (caixa).
 */
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
};
type Page = { id: string; properties: Record<string, Prop> };

const call = async (f: Fetch, token: string, path: string, method: string, body: unknown, what: string) => {
  const res = await f(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${what}: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
};

const query = async (f: Fetch, token: string, db: string, filter: unknown, what: string) =>
  (await call(f, token, `/databases/${db}/query`, 'POST', { page_size: 100, ...(filter ? { filter } : {}) }, what))
    .results as Page[];

const rich = (content: string) => ({ rich_text: content ? [{ text: { content: content.slice(0, 2000) } }] : [] });
const title = (content: string) => ({ title: [{ text: { content: content.slice(0, 2000) } }] });
const plain = (p?: Prop) =>
  (p?.rich_text ?? p?.title ?? [])
    .map((t) => t.plain_text)
    .join('')
    .trim();

/** Preço e estoque de cada produto do banco Produtos, casando pela coluna ID. */
export const fetchStock = async (f: Fetch, token: string, db: string): Promise<StockRow[]> =>
  (await query(f, token, db, null, 'ler produtos'))
    .map(({ properties: p }) => ({
      id: plain(p.ID),
      price: p.Preço?.number ?? null,
      available: p.Disponíveis?.number ?? null,
      active: p['Ativo no site']?.checkbox ?? true,
      presale: p['Pré-venda']?.checkbox ?? false,
    }))
    .filter((row) => row.id);

/**
 * Desconta `qty` de Disponíveis do produto, sem passar de zero.
 * shortcut: lê e grava em dois passos; dois pagamentos do mesmo item no mesmo segundo podem descontar um só.
 */
export const decrementStock = async (f: Fetch, token: string, db: string, id: string, qty: number) => {
  const [page] = await query(f, token, db, { property: 'ID', rich_text: { equals: id } }, 'achar produto');
  const available = page?.properties.Disponíveis?.number;
  if (!page || available == null) return;
  await call(
    f,
    token,
    `/pages/${page.id}`,
    'PATCH',
    { properties: { Disponíveis: { number: Math.max(0, available - qty) } } },
    'baixar estoque',
  );
};

export interface OrderRecord {
  serial: string;
  status: PaymentStatus | 'Novo';
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

export const updatePaymentStatus = (f: Fetch, token: string, pageId: string, status: PaymentStatus, payment: string) =>
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
