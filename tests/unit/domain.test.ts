import { describe, expect, it } from 'vitest';
import {
  addToCart,
  type CartEntry,
  cartCount,
  cartTotals,
  changeQty,
  describeEntry,
  needsShipping,
  packEntry,
  resolveCart,
  toEntry,
} from '../../src/domain/cart';
import { cardById, cardImage, ITEMS, itemName, productById, productSubtitle } from '../../src/domain/catalog';
import {
  dexTotals,
  filterDex,
  type HistoryEntry,
  requestShipment,
  toggleDex,
  type VaultEntry,
} from '../../src/domain/collection';
import { brl, escapeHtml, normalize, pad3, uniq } from '../../src/domain/format';
import { areaOf, isView, navGroup, parseRoute, routeHref, subnavKey } from '../../src/domain/routes';
import { demoAccount, initialState, mergePersisted } from '../../src/domain/state';
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
  it('imagem da carta no TCGdex: número com os dígitos do set e português só onde o set existe em PT', () => {
    expect(cardImage(cardById['base1-4'])).toBe('https://assets.tcgdex.net/en/base/base1/4/low.webp');
    expect(cardImage(cardById['base1-4'], 'PT', 'high')).toBe('https://assets.tcgdex.net/en/base/base1/4/high.webp');
    expect(cardImage(cardById['jungle-11'])).toBe('https://assets.tcgdex.net/en/base/base2/11/low.webp');
    expect(cardImage(cardById['sv151-6'], 'PT')).toBe('https://assets.tcgdex.net/pt/sv/sv03.5/006/low.webp');
    expect(cardImage(cardById['sv151-151'], 'EN', 'high')).toBe('https://assets.tcgdex.net/en/sv/sv03.5/151/high.webp');
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
    const cart: CartEntry[] = [];
    expect(addToCart(cart, 'i1')).toEqual({ ok: true, name: 'charizard 4/102' });
    expect(addToCart(cart, 'i1')).toEqual({ ok: false, error: 'só 1 un. em estoque' });
    expect(addToCart(cart, 'm1').ok).toBe(true);
    expect(addToCart(cart, 'm1').ok).toBe(true);
    expect(addToCart(cart, 'nao-existe')).toEqual({ ok: false, error: 'item indisponível' });
    expect(addToCart(cart, 'i7')).toEqual({ ok: false, error: 'item indisponível' });
    expect(cartCount(cart)).toBe(3);
    expect(cart).toEqual([
      { id: 'i1', qty: 1, dest: 'send' },
      { id: 'm1', qty: 2 },
    ]);
  });
  it('pré-venda também respeita a quantidade disponível (#25)', () => {
    const cart: CartEntry[] = [];
    for (let i = 0; i < 10; i++) expect(addToCart(cart, 'i9').ok).toBe(true);
    expect(addToCart(cart, 'i9')).toEqual({ ok: false, error: 'só 10 un. em estoque' });
    expect(changeQty(cart[0], 1)).toEqual({ ok: false, error: 'só 10 un. em estoque' });
  });
  it('quantidade nunca fica abaixo de 1 nem acima do estoque', () => {
    const cart: CartEntry[] = [];
    addToCart(cart, 'i2');
    expect(changeQty(cart[0], -1).ok).toBe(true);
    expect(cart[0].qty).toBe(1);
    changeQty(cart[0], 1);
    expect(changeQty(cart[0], 1)).toEqual({ ok: false, error: 'só 2 un. em estoque' });
    addToCart(cart, 'k1');
    for (let i = 0; i < 5; i++) changeQty(cart[1], 1);
    expect(cart[1].qty).toBe(6);
  });
  it('preço, nome e cor vêm do catálogo, nunca do que foi salvo (#7)', () => {
    const saved = [{ id: 'i2', qty: 1, price: 1, name: 'falso', color: 'red;}' }] as unknown as CartEntry[];
    const { lines } = resolveCart(saved);
    expect(lines[0]).toMatchObject({ name: 'blastoise 2/102', price: 420, color: null, dest: 'send', kind: 'item' });
    expect(toEntry(lines[0])).toEqual({ id: 'i2', qty: 1, dest: 'send' });
  });
  it('item que sumiu ou esgotou sai do carrinho; quantidade acima do estoque é cortada', () => {
    const { lines, dropped } = resolveCart([
      { id: 'i7', qty: 1 },
      { id: 'sumiu', qty: 1 },
      { id: 'i1', qty: 5, dest: 'vault' },
      { id: 'm3', qty: 2 },
    ]);
    expect(dropped).toBe(2);
    expect(lines.map((l) => [l.id, l.qty, l.dest])).toEqual([
      ['i1', 1, 'vault'],
      ['m3', 2, undefined],
    ]);
    expect(lines[1]).toMatchObject({ color: '#3A434F', sub: 'colecionável #003', price: 22 });
  });
  it('pacote só sai com 3 miniaturas e é descrito pelo catálogo', () => {
    expect(packEntry(['m1', 'm2'], 1)).toBeNull();
    expect(packEntry(['m1', 'm2', 'i1'], 1)).toBeNull();
    const pack = packEntry(['m1', 'm2', 'm10'], 7);
    expect(pack).toEqual({ id: 'pack-7', qty: 1, pack: ['m1', 'm2', 'm10'] });
    expect(describeEntry(pack as CartEntry)).toMatchObject({
      price: 54,
      sub: 'base, ciano, brilha no escuro',
      kind: 'pack',
    });
    expect(describeEntry({ id: 'pack-1', qty: 1, pack: ['m1'] })).toBeNull();
  });
  it('frete só conta quando algo não vai para o cofre', () => {
    const { lines } = resolveCart([{ id: 'i2', qty: 1, dest: 'vault' }]);
    expect(needsShipping(lines)).toBe(false);
    expect(cartTotals(lines, 20)).toEqual({ sub: 420, ship: 0, total: 420, needsShipping: false });
    const both = resolveCart([...lines.map(toEntry), { id: 'a1', qty: 1 }]).lines;
    expect(cartTotals(both, null).total).toBe(438);
    expect(cartTotals(both, 20).total).toBe(458);
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
    expect(formatCep('01310')).toBe('01310');
    expect(isEmail('a@b.co x')).toBe(false);
    expect(isEmail('x a@b.co')).toBe(false);
    expect(formatCep('01310100')).toBe('01310-100');
  });
  it('contagem regressiva', () => {
    const now = new Date('2026-11-13T10:58:57-03:00').getTime();
    expect(countdown('2026-11-14T12:00:00-03:00', now)).toBe('1d 01h 01m 03s');
    expect(countdown('2026-11-14T12:00:00-03:00', now + 864e5 * 2)).toBe('já saiu');
    expect(countdown('data ruim', now)).toBe('já saiu');
    expect(countdown('2026-11-14T12:00:00-03:00', new Date('2026-11-14T12:00:00-03:00').getTime())).toBe('já saiu');
  });
});

describe('rotas', () => {
  it('lê e monta URLs com tela e id (#8)', () => {
    expect(parseRoute('#/carta/base1-4')).toEqual({ view: 'carta', id: 'base1-4' });
    expect(parseRoute('#/apoio/faq')).toEqual({ view: 'apoio', id: 'faq' });
    expect(parseRoute('#tcg')).toEqual({ view: 'tcg', id: null });
    expect(parseRoute('')).toEqual({ view: 'home', id: null });
    expect(parseRoute('#/xyz/1')).toEqual({ view: 'home', id: null });
    expect(parseRoute('#/set/"><img src=x>')).toEqual({ view: 'set', id: 'imgsrcx' });
    expect(routeHref('set', 'jungle')).toBe('#/set/jungle');
    expect(routeHref('dex')).toBe('#/dex');
  });
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
  it('visitante novo começa deslogado e sem dados de exemplo (#5)', () => {
    const s = mergePersisted(initialState(), null);
    expect(s.user).toBeNull();
    expect(s.dex).toEqual({});
    expect(s.vault).toEqual([]);
    expect(s.hist).toEqual([]);
  });
  it('a conta demo traz Dex, cofre e histórico de exemplo', () => {
    const demo = demoAccount();
    expect(demo.user).toMatchObject({ name: 'colecionador demo', demo: true });
    expect(Object.keys(demo.dex)).toHaveLength(7);
    expect(demo.vault).toHaveLength(4);
    expect(demoAccount().vault).not.toBe(demo.vault);
  });
  it('valida campo a campo o que veio do navegador (#9)', () => {
    const s = mergePersisted(initialState(), {
      user: { name: 'ana', email: 'a@b.co', demo: 'sim' },
      cart: [
        { id: 'm1', qty: 2, color: '"><img src=x onerror=alert(1)>' },
        { id: 'i2', qty: 1, dest: 'vault' },
        { id: 'i2', qty: 1, dest: 'lixo' },
        { id: 'm2', qty: 1.5 },
        { id: 'm2', qty: 0 },
        { id: 'nao-existe', qty: 1 },
        { id: 'pack-1', qty: 1, pack: ['m1', 'm2', 'm3'] },
        { id: 'pack-2', qty: 1, pack: ['m1', 'x'] },
        'lixo',
      ],
      dex: { m1: 'have', m2: 'talvez', zz: 'have' },
      vault: [
        { id: 'v1', name: 'a', meta: 'b', date: '1/1', qty: 1, st: 'cofre' },
        { id: 'v2', name: 'a', meta: 'b', date: '1/1', qty: '1"><b>', st: 'cofre' },
        { id: 'v3', name: 'a', meta: 'b', date: '1/1', qty: 1, st: 'perdido' },
      ],
      hist: [
        { d: '1/1', t: 'ok' },
        { d: 1, t: 'x' },
      ],
    });
    expect(s.user).toEqual({ name: 'ana', email: 'a@b.co' });
    expect(s.cart).toEqual([
      { id: 'm1', qty: 2 },
      { id: 'i2', qty: 1, dest: 'vault' },
      { id: 'i2', qty: 1 },
      { id: 'pack-1', qty: 1, pack: ['m1', 'm2', 'm3'] },
    ]);
    expect(s.dex).toEqual({ m1: 'have' });
    expect(s.vault.map((v) => v.id)).toEqual(['v1']);
    expect(s.hist).toEqual([{ d: '1/1', t: 'ok' }]);
  });
  it('ignora formatos errados sem quebrar', () => {
    const s = mergePersisted(initialState(), { user: 'x', cart: 'x', dex: [], vault: {}, hist: 3 });
    expect(s).toMatchObject({ user: null, cart: [], dex: {}, vault: [], hist: [] });
    expect(mergePersisted(initialState(), [1, 2]).user).toBeNull();
  });
});
