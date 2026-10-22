import { afterEach, describe, expect, it } from 'vitest';
import { addToCart, packEntry, resolveCart } from '../../src/domain/cart';
import { ITEMS, isListed, PRODUCTS, photoUrl, productById } from '../../src/domain/catalog';
import { quoteRequestText, whatsappUrl } from '../../src/domain/contact';
import { describeLine, makeSerial, OrderError, SERIAL_PATTERN, validateOrder } from '../../src/domain/order';
import {
  nextOrderStatus,
  pickShippingOptions,
  type ShippingOption,
  shippingDays,
  shippingLabel,
  shippingProducts,
} from '../../src/domain/shipping';
import { applyStock, parseStockRows } from '../../src/domain/stock';

const opt = (id: number, price: number, days: number, name = `s${id}`, company = 'Correios'): ShippingOption => ({
  id,
  name,
  company,
  price,
  days,
});

describe('frete', () => {
  it('nomeia o serviço sem repetir a transportadora', () => {
    expect(shippingLabel({ name: 'PAC', company: 'Correios' })).toBe('Correios PAC');
    expect(shippingLabel({ name: 'Jadlog .Package', company: 'Jadlog' })).toBe('Jadlog .Package');
    expect(shippingLabel({ name: 'Expresso', company: '' })).toBe('Expresso');
    expect(shippingDays(1)).toBe('1 dia útil');
    expect(shippingDays(5)).toBe('5 dias úteis');
  });
  it('mostra até 4 opções, mais baratas primeiro, com a mais rápida sempre presente', () => {
    const all = [opt(1, 30, 3), opt(2, 10, 9), opt(3, 12, 8), opt(4, 15, 7), opt(5, 20, 6), opt(6, 50, 1)];
    expect(pickShippingOptions(all).map((o) => o.id)).toEqual([2, 3, 4, 6]);
    expect(pickShippingOptions([opt(1, 10, 2), opt(2, 10, 1)]).map((o) => o.id)).toEqual([2, 1]);
    expect(pickShippingOptions([])).toEqual([]);
  });
  it('monta caixas por tipo de item, com valor segurado', () => {
    expect(shippingProducts([{ id: 'i1', kind: 'item', qty: 2, price: 890 }])).toEqual([
      { id: 'i1', weight: 0.05, width: 9, height: 1, length: 12, insurance_value: 890, quantity: 2 },
    ]);
  });
  it('status do pedido acompanha o Mercado Pago; de Pago só sai por estorno', () => {
    expect(nextOrderStatus('Aguardando pagamento', 'approved')).toBe('Pago');
    expect(nextOrderStatus('Pago', 'refunded')).toBe('Estornado');
    expect(nextOrderStatus('Pago', 'charged_back')).toBe('Estornado');
    expect(nextOrderStatus('Pago', 'cancelled')).toBeNull();
    expect(nextOrderStatus('Estornado', 'approved')).toBeNull();
    expect(nextOrderStatus('Aguardando pagamento', 'refunded')).toBe('Cancelado');
    expect(nextOrderStatus('Aguardando pagamento', 'rejected')).toBe('Cancelado');
    expect(nextOrderStatus('Cancelado', 'cancelled')).toBeNull();
    expect(nextOrderStatus('Aguardando pagamento', 'in_process')).toBeNull();
  });
});

describe('estoque do Notion', () => {
  // O catálogo inteiro como o Notion o teria: aplicar tudo de uma vez devolve preço, estoque e "à venda".
  const everything = PRODUCTS.map((p) => ({
    id: p.id,
    price: p.price,
    available: p.kind === 'item' ? p.qty : null,
    active: p.kind !== 'item' || p.status !== 'esgotado',
    presale: p.kind === 'item' && p.status === 'prevenda',
  }));
  afterEach(() => {
    applyStock(everything);
  });

  it('aplica preço, quantidade e status às cartas e preço às peças', () => {
    const unknown = applyStock([
      { id: 'i2', price: 399, available: 0, active: true, presale: false },
      { id: 'i3', price: null, available: 7, active: true, presale: true },
      { id: 'i4', price: 55, available: 3, active: false, presale: false },
      { id: 'm1', price: 25, available: null, active: true, presale: false },
      { id: 'zz', price: 1, available: 1, active: true, presale: false },
    ]);
    expect(unknown).toEqual(['zz']);
    expect(productById.i2).toMatchObject({ price: 399, qty: 0, status: 'esgotado' });
    expect(ITEMS.find((i) => i.id === 'i2')).toMatchObject({ price: 399, qty: 0, status: 'esgotado' });
    expect(productById.i3).toMatchObject({ price: 150, qty: 7, status: 'prevenda' });
    expect(productById.i4).toMatchObject({ status: 'esgotado' });
    expect(productById.m1.price).toBe(25);
  });
  it('o que não está no Notion, ou está sem "Ativo no site", sai de venda (qualquer tipo de produto)', () => {
    applyStock([
      { id: 'i2', price: null, available: 2, active: true, presale: false },
      { id: 'm1', price: null, available: null, active: true, presale: false },
      { id: 'm2', price: null, available: null, active: false, presale: false },
      { id: 'k1', price: null, available: null, active: true, presale: false },
    ]);
    expect(isListed(productById.m1)).toBe(true);
    expect(isListed(productById.m2)).toBe(false); // inativo
    expect(isListed(productById.m3)).toBe(false); // não está no Notion
    expect(isListed(productById.a1)).toBe(false);
    expect(productById.i3).toMatchObject({ status: 'esgotado' }); // carta fora do Notion
    expect(isListed(undefined)).toBe(false);
    // Fora de venda não entra no carrinho (item, miniatura ou pacote), mesmo que esteja salvo no navegador.
    expect(addToCart([], 'm3')).toEqual({ ok: false, error: 'item indisponível' });
    expect(addToCart([], 'm1').ok).toBe(true);
    expect(
      resolveCart([
        { id: 'm2', qty: 1 },
        { id: 'm1', qty: 1 },
      ]).dropped,
    ).toBe(1);
    expect(packEntry(['m1', 'm1', 'm2'], 1)).toBeNull();
    expect(resolveCart([{ id: 'pack-1', qty: 1, pack: ['m1', 'm1', 'm2'] }]).lines).toEqual([]);
  });
  it('fotos próprias: vão para o produto e para o item da carta, e voltam a ficar vazias quando saem do Notion', () => {
    const key = 'fotos/i2/0123456789abcdef.jpg';
    applyStock(everything.map((r) => (r.id === 'i2' ? { ...r, photos: [key] } : r)));
    expect(productById.i2.photos).toEqual([key]);
    expect(ITEMS.find((i) => i.id === 'i2')?.photos).toEqual([key]);
    expect(photoUrl(key)).toBe(`/api/img/${key}`);
    applyStock(everything);
    expect(productById.i2.photos).toEqual([]);
  });
  it('lê com segurança o que veio da API', () => {
    expect(parseStockRows(null)).toEqual([]);
    expect(parseStockRows({ products: 'x' })).toEqual([]);
    expect(
      parseStockRows({
        products: [
          { id: 'i1', price: 10, available: 'x', photos: ['fotos/i1/0123456789abcdef.jpg', '../x', 7] },
          { price: 1 },
          { id: 'i2', active: false, presale: true },
        ],
      }),
    ).toEqual([
      { id: 'i1', price: 10, available: null, active: true, presale: false, photos: ['fotos/i1/0123456789abcdef.jpg'] },
      { id: 'i2', price: null, available: null, active: false, presale: true, photos: [] },
    ]);
  });
});

describe('pedido', () => {
  const address = {
    cep: '01310-100',
    street: 'Av. Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    uf: 'sp',
  };
  const base = {
    customer: { name: 'Ana Lima', email: 'ANA@exemplo.com ', cpf: '529.982.247-25', phone: '(11) 99999-8888' },
    address,
    shipping: { serviceId: 2 },
  };
  const fails = (input: unknown, status: number, msg: RegExp, vaultAllowed = false) => {
    try {
      validateOrder(input, { vaultAllowed });
    } catch (e) {
      expect(e).toBeInstanceOf(OrderError);
      expect((e as OrderError).status).toBe(status);
      expect((e as OrderError).message).toMatch(msg);
      return;
    }
    throw new Error('deveria falhar');
  };

  it('recalcula preço pelo catálogo e normaliza cliente e endereço', () => {
    const o = validateOrder(
      {
        ...base,
        items: [
          { id: 'i2', qty: 2, price: 1 },
          { id: 'm1', qty: 1 },
        ],
      },
      { vaultAllowed: false },
    );
    expect(o.goods).toBe(862);
    expect(o.customer).toEqual({
      name: 'Ana Lima',
      email: 'ana@exemplo.com',
      cpf: '52998224725',
      phone: '11999998888',
    });
    expect(o.address).toMatchObject({ cep: '01310100', uf: 'SP', complement: '' });
    expect(o.serviceId).toBe(2);
    expect(o.shipLines).toHaveLength(2);
    expect(describeLine(o.lines[0])).toBe('2× blastoise 2/102 (EN · normal)');
  });
  it('tudo no cofre dispensa endereço e frete, mas exige conta', () => {
    const items = [{ id: 'i2', qty: 1, dest: 'vault' }];
    fails({ ...base, items }, 401, /entre na sua conta/);
    const o = validateOrder({ customer: base.customer, items }, { vaultAllowed: true });
    expect(o).toMatchObject({ address: null, serviceId: null, shipLines: [] });
    expect(describeLine(o.lines[0])).toContain('guardar no cofre');
  });
  it('recusa carrinho vazio, item esgotado, quantidade acima do estoque e dados faltando', () => {
    fails({ ...base, items: [] }, 400, /vazio/);
    fails({ ...base, items: [{ id: 'i7', qty: 1 }] }, 409, /esgotou/);
    fails({ ...base, items: [{ id: 'i1', qty: 2 }] }, 409, /esgotou/);
    fails({ ...base, items: [{ id: 'm1', qty: 1 }], customer: { ...base.customer, name: 'A' } }, 400, /nome/);
    fails({ ...base, items: [{ id: 'm1', qty: 1 }], customer: { ...base.customer, email: 'x' } }, 400, /e-mail/);
    fails(
      { ...base, items: [{ id: 'm1', qty: 1 }], customer: { ...base.customer, cpf: '111.111.111-11' } },
      400,
      /CPF/,
    );
    fails({ ...base, items: [{ id: 'm1', qty: 1 }], customer: { ...base.customer, phone: '123' } }, 400, /telefone/);
    fails({ ...base, items: [{ id: 'm1', qty: 1 }], address: { ...address, uf: 'São' } }, 400, /Endereço/);
    fails({ ...base, items: [{ id: 'm1', qty: 1 }], address: null }, 400, /Endereço/);
    fails({ ...base, items: [{ id: 'm1', qty: 1 }], shipping: { serviceId: 'x' } }, 400, /frete/);
    fails(null, 400, /vazio/);
    fails({ ...base, items: [{ id: 'm1', qty: 1 }], shipping: undefined }, 400, /frete/);
  });
  it('serial com data e 6 caracteres sem ambiguidade', () => {
    const s = makeSerial(new Date('2026-10-16T12:00:00Z'), new Uint8Array([0, 1, 31, 32, 255, 100]));
    expect(s).toBe('CBX-20261016-AB9A9E');
    expect(SERIAL_PATTERN.test(s)).toBe(true);
    expect(SERIAL_PATTERN.test('CBX-20261016-AB1AZ6')).toBe(false);
  });
});

describe('WhatsApp', () => {
  it('monta a mensagem do orçamento e o link só com número válido', () => {
    const text = quoteRequestText({ name: ' Bia ', description: 'display de 12 cards', size: '', material: 'PLA' });
    expect(text).toBe(
      'Olá, Cubodex! Quero um orçamento de peça sob medida.\nNome: Bia\nO que preciso: display de 12 cards\nMaterial: PLA',
    );
    expect(whatsappUrl(text)).toBeNull();
    expect(whatsappUrl('oi & tchau', '5511900000000')).toBe('https://wa.me/5511900000000?text=oi%20%26%20tchau');
    expect(whatsappUrl('oi', '11900000000')).toBeNull();
    expect(quoteRequestText({ name: '', description: 'x', size: '90', material: '' })).toBe(
      'Olá, Cubodex! Quero um orçamento de peça sob medida.\nO que preciso: x\nMedidas: 90 mm',
    );
  });
});
