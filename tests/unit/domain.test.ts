import { describe, expect, it } from 'vitest';
import {
  addToCart,
  type CartLine,
  cartCount,
  cartTotals,
  changeQty,
  needsShipping,
  packLine,
} from '../../src/domain/cart';
import { ITEMS, itemName, productById, productSubtitle } from '../../src/domain/catalog';
import {
  dexTotals,
  filterDex,
  type HistoryEntry,
  requestShipment,
  toggleDex,
  type VaultEntry,
} from '../../src/domain/collection';
import { brl, escapeHtml, normalize, pad3, uniq } from '../../src/domain/format';
import { areaOf, isView, navGroup, subnavKey } from '../../src/domain/routes';
import { quoteCart, quoteVault } from '../../src/domain/shipping';
import { initialState, mergePersisted } from '../../src/domain/state';
import { cardsOfSet, cardsOnSale, emptyFilters, filterItems, filterSets, itemsOfCard } from '../../src/domain/tcg';
import { cepDigits, countdown, formatCep, isEmail } from '../../src/domain/validation';

describe('formatação', () => {
  it('escapa HTML, inclusive aspas de atributo', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    expect(escapeHtml(null)).toBe('');
  });
  it('formata reais, número da Dex, busca sem acento e únicos', () => {
    expect(brl(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50');
    expect(pad3(7)).toBe('007');
    expect(normalize('Psíquico ÁGUA')).toBe('psiquico agua');
    expect(uniq([1, 2, 1, 3])).toEqual([1, 2, 3]);
  });
});

describe('catálogo', () => {
  it('nomeia o item pela carta e o total do set', () => {
    expect(itemName(ITEMS[0])).toBe('charizard 4/102');
  });
  it('descreve cada tipo de produto no carrinho', () => {
    expect(productSubtitle(productById.i1)).toBe('EN · 1ª edição · PSA 8');
    expect(productSubtitle(productById.i9)).toBe('PT · holo · pré-venda');
    expect(productSubtitle(productById.m3)).toBe('colecionável #003');
    expect(productSubtitle(productById.k1)).toBe('criar');
    expect(productSubtitle(productById.a1)).toBe('acessório');
  });
});

describe('filtros do TCG', () => {
  const ids = (f: Partial<ReturnType<typeof emptyFilters>>) =>
    filterItems({ ...emptyFilters(), ...f }).map((i) => i.id);

  it('sem filtro lista tudo, do mais recente', () => {
    expect(ids({})).toHaveLength(12);
    expect(ids({})[0]).toBe('i9');
  });
  it('busca por nome ou set, sem acento', () => {
    expect(ids({ q: 'CHARIZARD' })).toEqual(['i8', 'i1', 'i12']);
    expect(ids({ q: 'fossil' })).toEqual(['i6']);
  });
  it('combina set, raridade, tipo, idioma, variante, gradação e estoque', () => {
    expect(ids({ set: 'sv151', lang: 'PT' })).toEqual(['i9', 'i8', 'i10']);
    expect(ids({ rar: 'comum', tipo: 'elétrico' })).toEqual(['i10', 'i4']);
    expect(ids({ variant: 'holo' })).toEqual(['i9', 'i12', 'i11']);
    expect(ids({ graded: true })).toEqual(['i1', 'i5']);
    expect(ids({ stock: true })).not.toContain('i7');
    expect(ids({ stock: true })).not.toContain('i9');
  });
  it('faixa de preço e ordenação', () => {
    expect(ids({ min: '400', max: '500' })).toEqual(['i5', 'i2']);
    expect(ids({ sort: 'menor' })[0]).toBe('i10');
    expect(ids({ sort: 'maior' })[0]).toBe('i1');
    expect(ids({ sort: 'az' })[0]).toBe('i2');
  });
  it('enciclopédia: cartas à venda, sets por busca/ano e cartas do set', () => {
    expect(itemsOfCard('jungle-11')).toEqual([]);
    expect(itemsOfCard('sv151-6').map((i) => i.id)).toEqual(['i8', 'i12']);
    expect(cardsOnSale('jungle')).toBe(0);
    expect(cardsOnSale('base1')).toBe(5);
    expect(filterSets('escarlate', '').map((s) => s.id)).toEqual(['sv151']);
    expect(filterSets('', '1999')).toHaveLength(3);
    const base = cardsOfSet('base1', '', false);
    expect(base.all.map((c) => c.n)).toEqual([1, 2, 4, 10, 15, 58]);
    expect(cardsOfSet('base1', 'comum', false).shown.map((c) => c.n)).toEqual([58]);
    expect(cardsOfSet('base1', '', true).shown.map((c) => c.n)).toEqual([2, 4, 10, 15, 58]);
  });
});

describe('carrinho', () => {
  it('soma unidades e respeita o estoque das cartas', () => {
    const cart: CartLine[] = [];
    expect(addToCart(cart, 'i1')).toEqual({ ok: true, name: 'charizard 4/102' });
    expect(addToCart(cart, 'i1')).toEqual({ ok: false, error: 'só 1 un. em estoque' });
    expect(addToCart(cart, 'm1').ok).toBe(true);
    expect(addToCart(cart, 'm1').ok).toBe(true);
    expect(addToCart(cart, 'nao-existe')).toEqual({ ok: false, error: 'item indisponível' });
    expect(cartCount(cart)).toBe(3);
    expect(cart[0]).toMatchObject({ kind: 'item', dest: 'send', color: null });
    expect(cart[1]).toMatchObject({ kind: 'mini', dest: null, color: '#F42744' });
  });
  it('quantidade nunca fica abaixo de 1 nem acima do estoque', () => {
    const cart: CartLine[] = [];
    addToCart(cart, 'i2');
    expect(changeQty(cart[0], -1).ok).toBe(true);
    expect(cart[0].qty).toBe(1);
    changeQty(cart[0], 1);
    expect(changeQty(cart[0], 1)).toEqual({ ok: false, error: 'só 2 un. em estoque' });
    addToCart(cart, 'k1');
    for (let i = 0; i < 5; i++) changeQty(cart[1], 1);
    expect(cart[1].qty).toBe(6);
  });
  it('pacote só sai com 3 miniaturas', () => {
    expect(packLine(['m1', 'm2'], 1)).toBeNull();
    expect(packLine(['m1', 'm2', 'm10'], 7)).toMatchObject({
      id: 'pack-7',
      price: 54,
      sub: 'base, ciano, brilha no escuro',
    });
  });
  it('frete só conta quando algo não vai para o cofre', () => {
    const cart: CartLine[] = [];
    addToCart(cart, 'i2');
    cart[0].dest = 'vault';
    expect(needsShipping(cart)).toBe(false);
    expect(cartTotals(cart, 20)).toEqual({ sub: 420, ship: 0, total: 420, needsShipping: false });
    addToCart(cart, 'a1');
    expect(cartTotals(cart, null).total).toBe(438);
    expect(cartTotals(cart, 20).total).toBe(458);
  });
  it('frete simulado depende do CEP e, no cofre, das unidades', () => {
    expect(quoteCart('01000000').map((o) => o.price)).toEqual([14.9, 27.5]);
    expect(quoteCart('90000000').map((o) => o.price)).toEqual([24.8, 41.9]);
    expect(quoteVault('01000000', 2).map((o) => o.price)).toEqual([15.9, 28.5]);
  });
});

describe('Dex e cofre', () => {
  it('conta, marca, desmarca e filtra', () => {
    const dex = { m1: 'have', m2: 'want' } as Record<string, 'have' | 'want'>;
    expect(dexTotals(dex)).toMatchObject({ total: 12, have: 1, want: 1 });
    toggleDex(dex, 'm1', 'have');
    expect(dex.m1).toBeUndefined();
    toggleDex(dex, 'm2', 'have');
    expect(dex.m2).toBe('have');
    expect(filterDex(dex, 'tenho').map((p) => p.id)).toEqual(['m2']);
    expect(filterDex(dex, 'quero')).toEqual([]);
    expect(filterDex(dex, 'faltam')).toHaveLength(11);
    expect(filterDex(dex, 'todos')).toHaveLength(12);
  });
  it('pedir envio muda só os itens selecionados que estão no cofre', () => {
    const vault: VaultEntry[] = [
      { id: 'v1', name: 'a', meta: '', date: '', qty: 1, st: 'cofre' },
      { id: 'v2', name: 'b', meta: '', date: '', qty: 1, st: 'enviado' },
      { id: 'v3', name: 'c', meta: '', date: '', qty: 1, st: 'cofre' },
    ];
    const hist: HistoryEntry[] = [];
    expect(requestShipment(vault, hist, { v1: true, v2: true }, '16/10')).toBe(1);
    expect(vault.map((v) => v.st)).toEqual(['envio', 'enviado', 'cofre']);
    expect(hist).toEqual([{ d: '16/10', t: 'pedido de envio · a' }]);
  });
});

describe('validação', () => {
  it('e-mail e CEP', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(cepDigits('01.310-100x9')).toBe('01310100');
    expect(formatCep('0131')).toBe('0131');
    expect(formatCep('01310100')).toBe('01310-100');
  });
  it('contagem regressiva', () => {
    const now = new Date('2026-11-13T10:58:57-03:00').getTime();
    expect(countdown('2026-11-14T12:00:00-03:00', now)).toBe('1d 01h 01m 03s');
    expect(countdown('2026-11-14T12:00:00-03:00', now + 864e5 * 2)).toBe('já saiu');
    expect(countdown('data ruim', now)).toBe('já saiu');
  });
});

describe('rotas', () => {
  it('reconhece telas e mapeia ala, menu e subnavegação', () => {
    expect(isView('dex')).toBe(true);
    expect(isView('toString')).toBe(false);
    expect(areaOf('carta')).toBe('tcg');
    expect(navGroup('dex')).toBe('col');
    expect(navGroup('colecionar')).toBe('col');
    expect(navGroup('criar')).toBe('criar');
    expect(navGroup('carrinho')).toBeUndefined();
    expect(subnavKey('serie')).toBe('colecionaveis');
    expect(subnavKey('cofre')).toBe('tcg');
    expect(subnavKey('colecionar')).toBe('colecionar');
    expect(subnavKey('home')).toBeNull();
  });
});

describe('estado salvo', () => {
  it('aproveita só os campos com a forma certa', () => {
    expect(mergePersisted(initialState(), null).user?.name).toBe('colecionador demo');
    const s = mergePersisted(initialState(), { user: null, cart: 'x', dex: { m1: 'have' }, vault: [], hist: 3 });
    expect(s.user).toBeNull();
    expect(s.cart).toEqual([]);
    expect(s.dex).toEqual({ m1: 'have' });
    expect(s.vault).toEqual([]);
    expect(s.hist.length).toBeGreaterThan(0);
  });
});
