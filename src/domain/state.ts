import type { CartEntry } from './cart';
import { MINIS, productById } from './catalog';
import type { Dex, DexFilter, HistoryEntry, VaultEntry } from './collection';
import type { ShippingOption } from './shipping';

interface User {
  name: string;
  email: string;
  /** Conta de demonstração: mostra pedidos e endereço de exemplo. */
  demo?: boolean;
}

/** O que fica salvo no navegador entre visitas. */
export interface PersistedState {
  user: User | null;
  cart: CartEntry[];
  dex: Dex;
  vault: VaultEntry[];
  hist: HistoryEntry[];
}

export interface AppState extends PersistedState {
  pack: string[];
  dexF: DexFilter;
  dexS: string;
  ship: ShippingOption | null;
  shipOpts: ShippingOption[];
  payNote: boolean;
  cep: string;
  apoio: string;
  img: boolean;
  setQ: string;
  setAno: string;
  setId: string;
  setRar: string;
  setOnly: boolean;
  cardId: string;
  vSel: Record<string, boolean>;
  vCep: string;
  vShipIdx: number | null;
}

const DEMO_USER: User = { name: 'colecionador demo', email: 'demo@exemplo.com', demo: true };

// Stryker disable all
const SEED_VAULT: VaultEntry[] = [
  { id: 'v1', name: 'blastoise 2/102', meta: 'EN · normal', date: '03/10', qty: 1, st: 'cofre' },
  { id: 'v2', name: 'pikachu 25/165', meta: 'PT · reverse holo', date: '09/10', qty: 2, st: 'cofre' },
  { id: 'v3', name: 'gengar 5/62', meta: 'EN · normal', date: '28/09', qty: 1, st: 'envio' },
  { id: 'v4', name: 'mewtwo 10/102', meta: 'EN · normal', date: '12/09', qty: 1, st: 'enviado' },
];
const SEED_HIST: HistoryEntry[] = [
  { d: '09/10', t: 'guardado no cofre · pikachu 25/165 (2 un.)' },
  { d: '09/10', t: 'compra · pikachu 25/165 (2 un.)' },
  { d: '03/10', t: 'guardado no cofre · blastoise 2/102' },
  { d: '03/10', t: 'compra · blastoise 2/102' },
  { d: '30/09', t: 'pedido de envio · gengar 5/62' },
  { d: '28/09', t: 'guardado no cofre · gengar 5/62' },
  { d: '15/09', t: 'enviado · mewtwo 10/102' },
  { d: '13/09', t: 'pedido de envio · mewtwo 10/102' },
  { d: '12/09', t: 'guardado no cofre · mewtwo 10/102' },
];
const SEED_DEX: Dex = { m1: 'have', m2: 'have', m4: 'have', m6: 'have', m9: 'have', m7: 'want', m11: 'want' };

/** Conta de demonstração com Dex, cofre e histórico de exemplo (só em "entrar como demo"). */
export const demoAccount = (): Pick<PersistedState, 'user' | 'dex' | 'vault' | 'hist'> => ({
  user: { ...DEMO_USER },
  dex: { ...SEED_DEX },
  vault: SEED_VAULT.map((v) => ({ ...v })),
  hist: SEED_HIST.map((h) => ({ ...h })),
});

/** Visitante novo: deslogado, carrinho, Dex e cofre vazios. */
export const initialState = (): AppState => ({
  user: null,
  cart: [],
  dex: {},
  vault: [],
  hist: [],
  pack: [],
  dexF: 'todos',
  dexS: 's1',
  ship: null,
  shipOpts: [],
  payNote: false,
  cep: '',
  apoio: 'sobre',
  img: true,
  setQ: '',
  setAno: '',
  setId: 'base1',
  setRar: '',
  setOnly: false,
  cardId: 'base1-4',
  vSel: {},
  vCep: '',
  vShipIdx: null,
});

// Stryker restore all

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isQty = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 99;
const VAULT_STATUS = new Set(['cofre', 'envio', 'enviado']);

const parseUser = (v: unknown): User | null =>
  isObj(v) && isText(v.name) && isText(v.email)
    ? { name: v.name, email: v.email, ...(v.demo === true ? { demo: true } : {}) }
    : null;

const parseCartEntry = (v: unknown): CartEntry[] => {
  if (!isObj(v) || !isText(v.id, 40) || !isQty(v.qty)) return [];
  const dest = v.dest === 'vault' || v.dest === 'send' ? v.dest : undefined;
  if (Array.isArray(v.pack)) {
    const pack = v.pack.filter((id): id is string => typeof id === 'string' && productById[id]?.kind === 'mini');
    return pack.length === v.pack.length ? [{ id: v.id, qty: v.qty, pack }] : [];
  }
  return productById[v.id] ? [{ id: v.id, qty: v.qty, ...(dest ? { dest } : {}) }] : [];
};

const parseVault = (v: unknown): VaultEntry[] =>
  isObj(v) &&
  isText(v.id, 40) &&
  isText(v.name) &&
  isText(v.meta) &&
  isText(v.date, 20) &&
  isQty(v.qty) &&
  VAULT_STATUS.has(v.st as string)
    ? [{ id: v.id, name: v.name, meta: v.meta, date: v.date, qty: v.qty, st: v.st as VaultEntry['st'] }]
    : [];

const parseHist = (v: unknown): HistoryEntry[] =>
  isObj(v) && isText(v.d, 20) && isText(v.t) ? [{ d: v.d, t: v.t }] : [];

const parseDex = (v: unknown): Dex => {
  if (!isObj(v)) return {};
  const dex: Dex = {};
  for (const m of MINIS) if (v[m.id] === 'have' || v[m.id] === 'want') dex[m.id] = v[m.id] as Dex[string];
  return dex;
};

/**
 * Junta o que veio salvo no navegador ao estado inicial. Tudo é validado campo a campo: o localStorage é
 * entrada não confiável e o que passa daqui vai para o HTML.
 */
export const mergePersisted = (base: AppState, saved: unknown): AppState => {
  if (!isObj(saved)) return base;
  base.user = parseUser(saved.user);
  if (Array.isArray(saved.cart)) base.cart = saved.cart.flatMap(parseCartEntry);
  base.dex = parseDex(saved.dex);
  if (Array.isArray(saved.vault)) base.vault = saved.vault.flatMap(parseVault);
  if (Array.isArray(saved.hist)) base.hist = saved.hist.flatMap(parseHist);
  return base;
};
