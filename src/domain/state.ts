import { type CartEntry, parseCartEntries } from './cart';
import { type Dex, type DexFilter, type HistoryEntry, parseDex, type VaultEntry } from './collection';
import { SERIAL_PATTERN } from './order';
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
  /** Pedido que saiu para o pagamento no Mercado Pago e ainda não voltou confirmado: só ele esvazia o carrinho. */
  pendingSerial: string;
}

interface AccountOrderView {
  serial: string;
  kind: 'compra' | 'envio';
  status: string;
  total: number;
  summary: string;
}

export type BuyerField =
  | 'name'
  | 'email'
  | 'cpf'
  | 'phone'
  | 'street'
  | 'number'
  | 'complement'
  | 'district'
  | 'city'
  | 'uf';

export interface AppState extends PersistedState {
  pack: string[];
  dexF: DexFilter;
  dexS: string;
  ship: ShippingOption | null;
  shipOpts: ShippingOption[];
  /** Frete sendo cotado / erro da última cotação. */
  quoting: boolean;
  quoteError: string;
  /** Formulário de finalizar compra aberto, enviando, e o erro do envio. */
  checkout: boolean;
  paying: boolean;
  payError: string;
  buyer: Record<BuyerField, string>;
  cep: string;
  /** Pedido aberto na página de volta do pagamento. */
  orderSerial: string;
  apoio: string;
  setQ: string;
  setAno: string;
  setId: string;
  setRar: string;
  setOnly: boolean;
  cardId: string;
  vSel: Record<string, boolean>;
  vCep: string;
  vShipIdx: number | null;
  /** Envio do cofre (conta real): opções cotadas, espera e erro. */
  vOpts: ShippingOption[];
  vBusy: string;
  vError: string;
  /** Pedidos da conta (vêm da API). */
  orders: AccountOrderView[];
  /** Mensagem da página da conta (link enviado, link expirado…). */
  accountMsg: string;
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
  pendingSerial: '',
  pack: [],
  dexF: 'todos',
  dexS: 's1',
  ship: null,
  shipOpts: [],
  quoting: false,
  quoteError: '',
  checkout: false,
  paying: false,
  payError: '',
  buyer: {
    name: '',
    email: '',
    cpf: '',
    phone: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    uf: '',
  },
  cep: '',
  orderSerial: '',
  apoio: 'sobre',
  setQ: '',
  setAno: '',
  setId: 'base1',
  setRar: '',
  setOnly: false,
  cardId: 'base1-4',
  vSel: {},
  vCep: '',
  vShipIdx: null,
  vOpts: [],
  vBusy: '',
  vError: '',
  orders: [],
  accountMsg: '',
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

const parseVault = (v: unknown): VaultEntry[] =>
  isObj(v) &&
  isText(v.id, 40) &&
  isText(v.name) &&
  isText(v.meta) &&
  isText(v.date, 20) &&
  isQty(v.qty) &&
  VAULT_STATUS.has(v.st as string)
    ? [
        {
          id: v.id,
          ...(isText(v.productId, 40) ? { productId: v.productId } : {}),
          name: v.name,
          meta: v.meta,
          date: v.date,
          qty: v.qty,
          st: v.st as VaultEntry['st'],
        },
      ]
    : [];

const parseHist = (v: unknown): HistoryEntry[] =>
  isObj(v) && isText(v.d, 20) && isText(v.t) ? [{ d: v.d, t: v.t }] : [];

/**
 * Junta o que veio salvo no navegador ao estado inicial. Tudo é validado campo a campo: o localStorage é
 * entrada não confiável e o que passa daqui vai para o HTML.
 */
export const mergePersisted = (base: AppState, saved: unknown): AppState => {
  if (!isObj(saved)) return base;
  base.user = parseUser(saved.user);
  base.cart = parseCartEntries(saved.cart);
  base.dex = parseDex(saved.dex);
  if (Array.isArray(saved.vault)) base.vault = saved.vault.flatMap(parseVault);
  if (Array.isArray(saved.hist)) base.hist = saved.hist.flatMap(parseHist);
  if (typeof saved.pendingSerial === 'string' && SERIAL_PATTERN.test(saved.pendingSerial))
    base.pendingSerial = saved.pendingSerial;
  return base;
};
