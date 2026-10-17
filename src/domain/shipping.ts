import type { CartLine } from './cart';

/** Opção de envio cotada no Melhor Envio. */
export interface ShippingOption {
  id: number;
  name: string;
  company: string;
  price: number;
  days: number;
}

/** "Correios PAC", "Jadlog .Package" — sem repetir a transportadora quando o serviço já a nomeia. */
export const shippingLabel = (o: Pick<ShippingOption, 'name' | 'company'>): string =>
  o.company && !o.name.toLowerCase().includes(o.company.toLowerCase()) ? `${o.company} ${o.name}` : o.name;

export const shippingDays = (days: number): string => (days === 1 ? '1 dia útil' : `${days} dias úteis`);

/** Até 4 opções, mais baratas primeiro, e a mais rápida sempre entre elas. */
export const pickShippingOptions = (options: ShippingOption[], max = 4): ShippingOption[] => {
  const byPrice = [...options].sort((a, b) => a.price - b.price || a.days - b.days);
  const picked = byPrice.slice(0, max);
  const fastest = [...options].sort((a, b) => a.days - b.days || a.price - b.price)[0];
  if (fastest && !picked.includes(fastest)) picked[picked.length - 1] = fastest;
  return picked;
};

interface Box {
  weight: number;
  width: number;
  height: number;
  length: number;
}

// shortcut: medidas e pesos de embalagem estimados; trocar pelas caixas reais da Cubodex (#21).
const BOX: Record<CartLine['kind'], Box> = {
  item: { weight: 0.05, width: 9, height: 1, length: 12 },
  acc: { weight: 0.1, width: 10, height: 4, length: 12 },
  mini: { weight: 0.08, width: 8, height: 8, length: 8 },
  pack: { weight: 0.25, width: 10, height: 8, length: 15 },
  craft: { weight: 0.4, width: 22, height: 12, length: 22 },
};

/** Produtos no formato da cotação do Melhor Envio (cm, kg, valor segurado em reais). */
export const shippingProducts = (lines: Pick<CartLine, 'id' | 'kind' | 'qty' | 'price'>[]) =>
  lines.map((l) => ({ id: l.id, ...BOX[l.kind], insurance_value: l.price, quantity: l.qty }));

export type PaymentStatus = 'Aguardando pagamento' | 'Pago' | 'Cancelado' | 'Estornado';

/**
 * Status do pedido depois de um aviso do Mercado Pago; null = não muda (aviso repetido ou intermediário).
 * Pago só sai de Pago por estorno ou chargeback (#39); Estornado é final.
 */
export const nextOrderStatus = (current: string, mp: string): PaymentStatus | null => {
  if (current === 'Estornado') return null;
  if (current === 'Pago') return mp === 'refunded' || mp === 'charged_back' ? 'Estornado' : null;
  if (mp === 'approved') return 'Pago';
  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(mp) && current !== 'Cancelado') return 'Cancelado';
  return null;
};
