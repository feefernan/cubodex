import type { CartLine } from './cart';
import type { Dex, DexFilter, HistoryEntry, VaultEntry } from './collection';
import type { ShippingOption } from './shipping';

export interface User {
  name: string;
  email: string;
}

/** O que fica salvo no navegador entre visitas. */
export interface PersistedState {
  user: User | null;
  cart: CartLine[];
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

export const DEMO_USER: User = { name: 'colecionador demo', email: 'demo@exemplo.com' };

// shortcut: o visitante começa logado como demo com dados de exemplo, como no protótipo — corrigir em #5.
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

export const initialState = (): AppState => ({
  user: { ...DEMO_USER },
  cart: [],
  dex: { ...SEED_DEX },
  vault: SEED_VAULT.map((v) => ({ ...v })),
  hist: SEED_HIST.map((h) => ({ ...h })),
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

/** Junta o que veio salvo ao estado inicial, campo a campo, ignorando o que tem forma errada. */
// shortcut: só confere o tipo de cada campo, não o conteúdo das linhas — validar de verdade em #9.
export const mergePersisted = (base: AppState, saved: unknown): AppState => {
  if (!saved || typeof saved !== 'object') return base;
  const st = saved as Partial<PersistedState>;
  if ('user' in st) base.user = st.user ?? null;
  if (Array.isArray(st.cart)) base.cart = st.cart;
  if (st.dex && typeof st.dex === 'object') base.dex = st.dex;
  if (Array.isArray(st.vault)) base.vault = st.vault;
  if (Array.isArray(st.hist)) base.hist = st.hist;
  return base;
};
