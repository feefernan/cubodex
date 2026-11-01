import { afterEach, describe, expect, it } from 'vitest';
import { addToCart, describeEntry, packEntry, resolveCart } from '../../src/domain/cart';
import {
  ITEMS,
  isListed,
  itemName,
  listedOf,
  MINIS,
  PACK,
  PRODUCTS,
  packPrice,
  parseCardRef,
  parseDef,
  parseItemSpec,
  productById,
} from '../../src/domain/catalog';
import { applyStock, parseStockRows } from '../../src/domain/stock';
import {
  emptyFilters,
  emptyShelf,
  filterItems,
  filterOptions,
  filterShelf,
  itemsOfTcgdexCard,
  onSaleBySet,
  shelfOptions,
} from '../../src/domain/tcg';
import { everything, packRow, resetCatalog } from '../catalog';

afterEach(resetCatalog);

describe('descrição vinda do Notion (parseDef)', () => {
  it('aceita miniatura, peça, acessório e pacote bem formados', () => {
    expect(parseDef({ kind: 'mini', name: ' fiozinho azul ', n: '13', rar: 'rara', color: '#3ED9F0' })).toEqual({
      kind: 'mini',
      name: 'fiozinho azul',
      n: 13,
      rar: 'rara',
      color: '#3ED9F0',
    });
    expect(
      parseDef({
        kind: 'craft',
        name: 'caixa',
        note: 'tampa',
        spec: [['material', 'PLA'], ['medidas', ''], ['x'], 'lixo'],
      }),
    ).toEqual({ kind: 'craft', name: 'caixa', note: 'tampa', spec: [['material', 'PLA']] });
    expect(parseDef({ kind: 'craft', name: 'sem lista' })).toEqual({
      kind: 'craft',
      name: 'sem lista',
      note: '',
      spec: [],
    });
    expect(parseDef({ kind: 'acc', name: 'luva', note: 'macia' })).toEqual({
      kind: 'acc',
      name: 'luva',
      note: 'macia',
    });
    expect(parseDef({ kind: 'pack', discount: 15 })).toEqual({ kind: 'pack', discount: 15 });
  });

  it('recusa o que está incompleto ou fora do formato (cor em estilo, raridade, número, desconto)', () => {
    expect(parseDef(null)).toBeNull();
    expect(parseDef({ kind: 'mini', name: 'x', n: 1, rar: 'rara', color: 'red;background:url(x)' })).toBeNull();
    expect(parseDef({ kind: 'mini', name: 'x', n: 1, rar: 'lendária', color: '#3ED9F0' })).toBeNull();
    expect(parseDef({ kind: 'mini', name: 'x', n: 0, rar: 'rara', color: '#3ED9F0' })).toBeNull();
    expect(parseDef({ kind: 'mini', name: '', n: 1, rar: 'rara', color: '#3ED9F0' })).toBeNull();
    expect(parseDef({ kind: 'craft', name: '' })).toBeNull();
    expect(parseDef({ kind: 'acc' })).toBeNull();
    expect(parseDef({ kind: 'pack', discount: 95 })).toBeNull();
    expect(parseDef({ kind: 'pack', discount: -1 })).toBeNull();
    expect(parseDef({ kind: 'pack', discount: 'x' })).toBeNull();
    expect(parseDef({ kind: 'carta', name: 'x' })).toBeNull();
  });

  it('a API leva a descrição junto, revalidada', () => {
    const rows = parseStockRows({
      products: [
        { id: 'm13', price: 30, def: { kind: 'mini', name: 'fiozinho azul', n: 13, rar: 'rara', color: '#3ED9F0' } },
        { id: 'm14', def: { kind: 'mini', name: 'x', n: 14, rar: 'rara', color: 'rgb(0,0,0)' } },
      ],
    });
    expect(rows[0].def).toMatchObject({ kind: 'mini', n: 13 });
    expect(rows[1].def).toBeUndefined();
  });
});

describe('produto novo só pelo Notion', () => {
  const row = (id: string, def: unknown, over: object = {}) => ({
    id,
    price: 30 as number | null,
    available: null,
    active: true,
    presale: false,
    def: parseDef(def) ?? undefined,
    ...over,
  });

  it('miniatura nova entra no catálogo, na Dex e na vitrine, na ordem do número', () => {
    applyStock([
      ...everything,
      packRow(10),
      row('m13', { kind: 'mini', name: 'fiozinho azul', n: 13, rar: 'rara', color: '#3ED9F0' }),
    ]);
    expect(productById.m13).toMatchObject({ kind: 'mini', name: 'fiozinho azul', price: 30, n: 13 });
    expect(MINIS.at(-1)?.id).toBe('m13');
    expect(MINIS).toHaveLength(13);
    expect(listedOf('mini').map((p) => p.id)).toContain('m13');
    expect(listedOf('mini', 2)).toHaveLength(2);
    expect(addToCart([], 'm13').ok).toBe(true);
  });

  it('peça e acessório novos; e o que o Notion muda de um produto existente vale (nome, cor, medidas)', () => {
    applyStock([
      ...everything,
      packRow(10),
      row('k7', { kind: 'craft', name: 'caixa de tokens', note: 'tampa', spec: [['material', 'PETG']] }, { price: 50 }),
      row('a5', { kind: 'acc', name: 'luva de cartas', note: 'macia' }),
      row(
        'k1',
        { kind: 'craft', name: 'organizador de dados xl', note: '8 vãos', spec: [['medidas', '120 × 60 mm']] },
        { price: 55 },
      ),
    ]);
    expect(productById.k7).toMatchObject({ kind: 'craft', price: 50 });
    expect(productById.a5).toMatchObject({ kind: 'acc', note: 'macia' });
    expect(productById.k1).toMatchObject({
      name: 'organizador de dados xl',
      price: 55,
      spec: [['medidas', '120 × 60 mm']],
    });
    expect(PRODUCTS.filter((p) => p.id === 'k1')).toHaveLength(1); // trocou no lugar, sem duplicar
  });

  it('produto novo sem preço, ou inativo, não se vende', () => {
    applyStock([
      ...everything,
      packRow(10),
      row('m13', { kind: 'mini', name: 'sem preço', n: 13, rar: 'rara', color: '#3ED9F0' }, { price: null }),
      row('k7', { kind: 'craft', name: 'desligada', note: '', spec: [] }, { active: false }),
    ]);
    expect(isListed(productById.m13)).toBe(false);
    expect(isListed(productById.k7)).toBe(false);
    expect(addToCart([], 'm13')).toEqual({ ok: false, error: 'item indisponível' });
  });
});

describe('pacote com desconto do Notion', () => {
  it('preço = soma das 3 miniaturas menos o desconto; mudar o desconto no Notion muda o preço', () => {
    expect(packPrice(['m1', 'm2', 'm10'])).toBe(74.7); // (22 + 22 + 39) × 0,90
    applyStock([...everything, packRow(25)]);
    expect(PACK.discount).toBe(25);
    expect(packPrice(['m1', 'm2', 'm10'])).toBe(62.25);
    const entry = packEntry(['m1', 'm2', 'm10'], 1);
    expect(entry && describeEntry(entry)?.price).toBe(62.25);
    expect(packPrice(['m1', 'nao-existe', 'm10'])).toBe(45.75); // id que sumiu vale 0: (22 + 39) × 0,75
  });

  it('sem a linha do pacote no Notion (ou inativa) o pacote não se vende', () => {
    applyStock(everything);
    expect(PACK.listed).toBe(false);
    expect(packEntry(['m1', 'm2', 'm3'], 1)).toBeNull();
    expect(describeEntry({ id: 'pack-1', qty: 1, pack: ['m1', 'm2', 'm3'] })).toBeNull();
    applyStock([...everything, { ...packRow(10), active: false }]);
    expect(PACK.listed).toBe(false);
    applyStock([...everything, packRow(10)]);
    expect(PACK.listed).toBe(true);
  });
});

const CARD = {
  id: 'sv03.5-100',
  setId: 'sv03.5',
  setName: '151',
  number: '100',
  total: 165,
  name: 'Kangaskhan ex',
  rarity: 'Double rare',
  types: 'Colorless',
  image: 'sv/sv03.5/100',
  pt: true,
};

describe('carta à venda só pelo Notion (3.3)', () => {
  it('a linha do Notion vira especificação: id do TCGdex, idioma, variante, gradação e data', () => {
    expect(
      parseItemSpec({
        kind: 'item',
        tcgdex: 'sv03.5-100',
        lang: 'PT',
        variant: 'holo',
        grade: 'psa 9,5',
        created: '2026-10-20T10:00:00.000Z',
      }),
    ).toEqual({
      kind: 'item',
      tcgdex: 'sv03.5-100',
      lang: 'PT',
      variant: 'holo',
      grade: { co: 'PSA', n: 9.5 },
      created: '2026-10-20T10:00:00.000Z',
    });
    // idioma desconhecido vira EN, variante vazia vira "normal", gradação ou data inválidas somem
    expect(
      parseItemSpec({ kind: 'item', tcgdex: 'base1-4', lang: 'xx', variant: '', grade: 'sem nota', created: 'ontem' }),
    ).toEqual({
      kind: 'item',
      tcgdex: 'base1-4',
      lang: 'EN',
      variant: 'normal',
      grade: null,
      created: null,
    });
    expect(parseItemSpec({ kind: 'item', tcgdex: '', lang: 'EN' })).toBeNull();
    expect(parseItemSpec({ kind: 'item', tcgdex: "a'; drop" })).toBeNull();
    expect(parseItemSpec({ kind: 'mini', tcgdex: 'base1-4' })).toBeNull();
    expect(parseItemSpec({ kind: 'item', tcgdex: 'a', grade: { co: 'CGC', n: 11 } })?.grade).toBeNull(); // nota fora de 1 a 10
    expect(parseItemSpec({ kind: 'item', tcgdex: 'a', grade: { co: 'CGC', n: 8 } })?.grade).toEqual({
      co: 'CGC',
      n: 8,
    });
  });

  it('a carta do TCGdex só entra com id, set, nome, número e total válidos; imagem fora do formato some', () => {
    expect(parseCardRef(CARD)).toEqual(CARD);
    expect(parseCardRef({ ...CARD, image: '../../x' })?.image).toBeNull();
    expect(parseCardRef({ ...CARD, rarity: undefined, types: undefined, setName: '' })).toMatchObject({
      rarity: '',
      types: '',
      setName: 'sv03.5',
    });
    expect(parseCardRef({ ...CARD, id: 'a b' })).toBeNull();
    expect(parseCardRef({ ...CARD, total: -1 })).toBeNull();
    expect(parseCardRef({ ...CARD, name: '' })).toBeNull();
    expect(parseCardRef(null)).toBeNull();
    expect(parseDef({ kind: 'item', card: CARD })).toMatchObject({ kind: 'item', lang: 'EN', variant: 'normal' });
    expect(parseDef({ kind: 'item', card: null })).toBeNull();
  });

  const row = (id: string, def: unknown, over: object = {}) => ({
    id,
    price: 99 as number | null,
    available: 3 as number | null,
    active: true,
    presale: false,
    def: parseDef(def) ?? undefined,
    ...over,
  });

  it('carta nova no Notion aparece na loja, no carrinho e nos filtros, sem mudar o código', () => {
    applyStock([
      ...everything,
      packRow(10),
      row('i13', {
        kind: 'item',
        card: CARD,
        lang: 'PT',
        variant: 'holo',
        grade: { co: 'PSA', n: 9 },
        created: '2099-01-01T00:00:00Z',
      }),
    ]);
    const item = ITEMS.find((i) => i.id === 'i13');
    expect(item).toMatchObject({ price: 99, qty: 3, status: 'estoque', variant: 'holo', grade: { co: 'PSA', n: 9 } });
    expect(itemName(item as never)).toBe('Kangaskhan ex 100/165');
    expect(productById.i13).toMatchObject({
      kind: 'item',
      name: 'Kangaskhan ex 100/165',
      qty: 3,
      grade: { co: 'PSA', n: 9 },
    });
    expect(addToCart([], 'i13').ok).toBe(true);
    expect(resolveCart([{ id: 'i13', qty: 9, dest: 'send' }]).lines[0]).toMatchObject({ qty: 3, price: 99 }); // nunca passa do estoque
    // a mais nova (data de criação no futuro) vem primeiro em "mais recentes"
    expect(ITEMS.filter((i) => i.status !== 'esgotado').sort((a, b) => a.added - b.added)[0].id).toBe('i13');
  });

  it('o que o Notion muda de uma carta existente vale (preço, variante, gradação) e a foto própria fica', () => {
    applyStock([
      ...everything.map((r) => (r.id === 'i1' ? { ...r, photos: ['fotos/i1/0123456789abcdef.jpg'] } : r)),
      packRow(10),
      row(
        'i1',
        {
          kind: 'item',
          card: {
            ...CARD,
            id: 'base1-4',
            setId: 'base1',
            setName: 'Base Set',
            number: '4',
            total: 102,
            name: 'Charizard',
          },
          lang: 'EN',
          variant: 'holo',
          grade: null,
          created: null,
        },
        { price: 1000, photos: ['fotos/i1/0123456789abcdef.jpg'] },
      ),
    ]);
    const item = ITEMS.find((i) => i.id === 'i1');
    expect(item).toMatchObject({ price: 1000, variant: 'holo', photos: ['fotos/i1/0123456789abcdef.jpg'] });
    expect(item?.grade).toBeUndefined();
    expect(ITEMS.filter((i) => i.id === 'i1')).toHaveLength(1);
    expect(PRODUCTS.filter((p) => p.id === 'i1')).toHaveLength(1);
  });
});

describe('estoque de acessórios e lacrados', () => {
  const acc = (id: string, available: number | null) => ({
    id,
    price: 25,
    available,
    active: true,
    presale: false,
    def: parseDef({ kind: 'acc', name: 'triple pack', note: '', group: 'lacrado', lang: 'PT', set: 'Caos Ascendente' }),
  });

  it('com quantidade no Notion, o carrinho respeita o estoque; zerado, o item some da compra', () => {
    applyStock([...everything, acc('a9', 2)]);
    expect(productById.a9).toMatchObject({ group: 'lacrado', lang: 'PT', set: 'Caos Ascendente', qty: 2 });
    const cart: { id: string; qty: number }[] = [];
    expect(addToCart(cart, 'a9').ok).toBe(true);
    expect(addToCart(cart, 'a9').ok).toBe(true);
    expect(addToCart(cart, 'a9')).toEqual({ ok: false, error: 'só 2 un. em estoque' });
    applyStock([...everything, acc('a9', 0)]);
    expect(addToCart([], 'a9')).toEqual({ ok: false, error: 'item indisponível' });
  });

  it('sem quantidade no Notion, não há limite nem contagem', () => {
    applyStock([...everything, acc('a9', null)]);
    expect((productById.a9 as { qty?: number }).qty).toBeUndefined();
    expect(addToCart([], 'a9').ok).toBe(true);
  });

  it('idioma fora de PT/EN é ignorado e a coleção é cortada em 60 caracteres', () => {
    expect(parseDef({ kind: 'acc', name: 'x', note: '', lang: 'FR', set: 'a'.repeat(80) })).toEqual({
      kind: 'acc',
      name: 'x',
      note: '',
      set: 'a'.repeat(60),
    });
  });
});

describe('carta inativa no Notion some das vitrines; esgotada continua aparecendo', () => {
  it('filtros, página da carta e contagem por set só consideram o que está à venda ou esgotado de verdade', () => {
    applyStock(
      everything.map((r) => (r.id === 'i2' ? { ...r, active: false } : r.id === 'i3' ? { ...r, available: 0 } : r)),
    );
    const ids = filterItems(emptyFilters()).map((i) => i.id);
    expect(ids).not.toContain('i2');
    expect(ids).toContain('i3');
    expect(ITEMS.find((i) => i.id === 'i3')).toMatchObject({ status: 'esgotado', listed: true });
    expect(ITEMS.find((i) => i.id === 'i2')?.listed).toBe(false);
    const hidden = ITEMS.find((i) => i.id === 'i2');
    expect(itemsOfTcgdexCard(hidden?.card.id ?? '').map((i) => i.id)).not.toContain('i2');
    expect(filterOptions().sets.length).toBeGreaterThan(0);
    expect(onSaleBySet().size).toBeGreaterThan(0);
  });
});

describe('selados e acessórios: busca, filtros e esgotados no fim', () => {
  const acc = (id: string, price: number, available: number | null, extra: object) => ({
    id,
    price,
    available,
    active: true,
    presale: false,
    def: parseDef({ kind: 'acc', name: id, note: '', ...extra }),
  });
  const rows = [
    acc('b1', 30, 0, { group: 'lacrado', lang: 'PT', set: 'Caos Ascendente' }),
    acc('b2', 20, 5, { group: 'lacrado', lang: 'EN', set: 'Equilíbrio Perfeito' }),
    acc('b3', 10, 2, { group: 'lacrado', lang: 'PT', set: 'Equilíbrio Perfeito' }),
    acc('c1', 15, null, {}),
  ];
  const shelf = () => listedOf('acc');
  const ids = (f: Partial<ReturnType<typeof emptyShelf>>) =>
    filterShelf(shelf(), { ...emptyShelf(), ...f })
      .map((p) => p.id)
      .filter((id) => /^[bc]/.test(id));

  it('esgotado vai para o fim, e a ordem de cada grupo se mantém', () => {
    applyStock([...everything, ...rows]);
    const all = ids({});
    expect(all.at(-1)).toBe('b1');
    expect(ids({ sort: 'menor' })).toEqual(['b3', 'c1', 'b2', 'b1']);
    expect(ids({ sort: 'maior' }).slice(0, 3)).toEqual(['b2', 'c1', 'b3']);
    expect(ids({ sort: 'az' }).slice(0, 2)).toEqual(['b2', 'b3']);
  });

  it('busca por nome ou coleção sem acento, e filtros de tipo, coleção, idioma, preço e estoque', () => {
    applyStock([...everything, ...rows]);
    expect(ids({ q: 'equilibrio' })).toEqual(['b2', 'b3']);
    expect(ids({ group: 'acc' })).toContain('c1');
    expect(ids({ group: 'acc' })).not.toContain('b2');
    expect(ids({ group: 'lacrado', lang: 'PT' }).sort()).toEqual(['b1', 'b3']);
    expect(ids({ set: 'Caos Ascendente' })).toEqual(['b1']);
    expect(ids({ stock: true })).not.toContain('b1');
    expect(ids({ min: '12', max: '25', group: 'lacrado' })).toEqual(['b2']);
    expect(shelfOptions(shelf())).toEqual({
      sets: ['Caos Ascendente', 'Equilíbrio Perfeito'],
      langs: ['EN', 'PT'],
    });
  });

  it('cartas esgotadas vão para o fim da lista de cartas à venda', () => {
    applyStock(everything.map((r) => (r.id === 'i2' ? { ...r, available: 0 } : r)));
    const list = filterItems(emptyFilters()).map((i) => i.id);
    expect(list.at(-1)).toBe('i2');
    expect(list.indexOf('i2')).toBeGreaterThan(list.indexOf('i3'));
  });
});
