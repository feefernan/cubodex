import { type CartLine, parseCartEntries, resolveCart } from './cart';
import { isEmail } from './validation';

export interface Address {
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  uf: string;
}

interface Customer {
  name: string;
  email: string;
}

/** Erro de pedido com o status HTTP que a API devolve e a mensagem que o cliente vê. */
export class OrderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ValidOrder {
  lines: CartLine[];
  customer: Customer;
  /** null quando tudo vai para o cofre. */
  address: Address | null;
  serviceId: number | null;
  goods: number;
  /** Linhas que viajam agora (as do cofre ficam na Cubodex). */
  shipLines: CartLine[];
}

const cents = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const parseAddress = (raw: unknown): Address | null => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const a: Address = {
    cep: text(o.cep, 9).replace(/\D/g, ''),
    street: text(o.street, 200),
    number: text(o.number, 20),
    complement: text(o.complement, 100),
    district: text(o.district, 100),
    city: text(o.city, 100),
    uf: text(o.uf, 2).toUpperCase(),
  };
  return a.cep.length === 8 && a.street && a.number && a.city && /^[A-Z]{2}$/.test(a.uf) ? a : null;
};

/**
 * Confere e recalcula o pedido a partir do catálogo atual. O navegador manda só ids, quantidades,
 * dados de entrega e o serviço de frete escolhido; preço, total e frete são sempre do servidor.
 */
export const validateOrder = (raw: unknown, opts: { vaultAllowed: boolean }): ValidOrder => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const entries = parseCartEntries(o.items);
  if (!entries.length) throw new OrderError(400, 'Carrinho vazio');
  const { lines, dropped } = resolveCart(entries);
  if (dropped || lines.some((l, i) => l.qty !== entries[i].qty))
    throw new OrderError(409, 'Algum item esgotou ou mudou de quantidade. Revise o carrinho.');
  if (!opts.vaultAllowed && lines.some((l) => l.dest === 'vault'))
    throw new OrderError(401, 'Para guardar cartas no cofre, entre na sua conta.');

  const c = (o.customer ?? {}) as Record<string, unknown>;
  const customer = { name: text(c.name, 120), email: text(c.email, 200).toLowerCase() };
  if (customer.name.length < 2) throw new OrderError(400, 'Digite seu nome.');
  if (!isEmail(customer.email)) throw new OrderError(400, 'Digite um e-mail válido.');

  const shipLines = lines.filter((l) => l.dest !== 'vault');
  let address: Address | null = null;
  let serviceId: number | null = null;
  if (shipLines.length) {
    address = parseAddress(o.address);
    if (!address) throw new OrderError(400, 'Endereço de entrega incompleto.');
    serviceId = Number((o.shipping as { serviceId?: unknown } | undefined)?.serviceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0) throw new OrderError(400, 'Escolha uma opção de frete.');
  }
  const goods = cents(lines.reduce((a, l) => a + l.price * l.qty, 0));
  return { lines, customer, address, serviceId, goods, shipLines };
};

/** Linha legível do pedido para o Notion e o Mercado Pago. */
export const describeLine = (l: CartLine): string =>
  `${l.qty}× ${l.name} (${l.sub})${l.dest === 'vault' ? ' · guardar no cofre' : ''}`;

export const SERIAL_PATTERN = /^CBX-\d{8}-[A-Z2-9]{6}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** "CBX-20261016-K7Q2MZ": data + 6 caracteres aleatórios (32^6 ≈ 1 bilhão por dia). */
export const makeSerial = (now: Date, random: Uint8Array): string => {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const code = Array.from(random.slice(0, 6), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `CBX-${day}-${code}`;
};
