/** Cotação de frete no Melhor Envio (conta própria do Cubodex; docs.melhorenvio.com.br, "Cálculo de fretes"). */
import type { CartLine } from '../../src/domain/cart';
import { type ShippingOption, shippingProducts } from '../../src/domain/shipping';

export interface MelhorEnvioEnv {
  MELHOR_ENVIO_API: string;
  MELHOR_ENVIO_TOKEN: string;
  ORIGIN_CEP: string;
  CONTACT_EMAIL: string;
}

interface Quote {
  id: number;
  name: string;
  price?: string;
  custom_price?: string;
  delivery_time?: number;
  custom_delivery_time?: number;
  company?: { name?: string };
  error?: string;
}

/** Opções de envio das linhas até o CEP `to`, mais baratas primeiro. */
export const quoteShipping = async (
  f: typeof fetch,
  env: MelhorEnvioEnv,
  to: string,
  lines: Pick<CartLine, 'id' | 'kind' | 'qty' | 'price'>[],
): Promise<ShippingOption[]> => {
  const res = await f(`${env.MELHOR_ENVIO_API}/api/v2/me/shipment/calculate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.MELHOR_ENVIO_TOKEN}`,
      // O Melhor Envio exige nome do app e um e-mail de contato técnico.
      'User-Agent': `Cubodex (${env.CONTACT_EMAIL})`,
    },
    body: JSON.stringify({
      from: { postal_code: env.ORIGIN_CEP },
      to: { postal_code: to },
      products: shippingProducts(lines),
    }),
  });
  if (!res.ok) throw new Error(`Melhor Envio cotação: ${res.status} ${await res.text()}`);
  const quotes = (await res.json()) as Quote[];
  return quotes
    .filter((q) => !q.error && (q.custom_price ?? q.price))
    .map((q) => ({
      id: q.id,
      name: q.name,
      company: q.company?.name ?? '',
      // custom_*: já com as taxas e descontos da conta (recomendado pela documentação).
      price: Math.round(Number(q.custom_price ?? q.price) * 100) / 100,
      days: Number(q.custom_delivery_time ?? q.delivery_time ?? 0),
    }))
    .sort((a, b) => a.price - b.price);
};
