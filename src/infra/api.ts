/** Cliente da API da loja (mesma origem, /api/*) e do ViaCEP. Erros viram ApiError com a mensagem para o cliente. */
import type { CartEntry } from '../domain/cart';
import type { Address } from '../domain/order';
import type { ShippingOption } from '../domain/shipping';

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Sem conexão. Confira a internet e tente de novo.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Algo deu errado. Tente de novo.');
  return data as T;
};

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface OrderRequest {
  items: CartEntry[];
  customer: { name: string; email: string };
  address: Address | null;
  shipping: { serviceId: number } | null;
}

export const api = {
  catalog: () => call<unknown>('/api/catalog'),
  quote: (cep: string, items: CartEntry[]) =>
    post<{ options: ShippingOption[] }>('/api/shipping/quote', { cep, items }).then((d) => d.options),
  order: (body: OrderRequest) =>
    post<{ serial: string; total: number; checkoutUrl: string | null }>('/api/orders', body),
  status: (serial: string) =>
    call<{ status: string }>(`/api/orders/${encodeURIComponent(serial)}/status`).then((d) => d.status),
  subscribe: (email: string) => post<{ ok: true }>('/api/avisos', { email, consent: true }),
};

/** Endereço pelo CEP (ViaCEP); null se o CEP não existe ou o serviço falhou — o cliente digita à mão. */
export const lookupCep = async (cep: string): Promise<Partial<Address> | null> => {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const d = (await res.json()) as {
      erro?: unknown;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
    if (!res.ok || d.erro) return null;
    return { street: d.logradouro ?? '', district: d.bairro ?? '', city: d.localidade ?? '', uf: d.uf ?? '' };
  } catch {
    return null;
  }
};
