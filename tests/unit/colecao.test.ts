import { describe, expect, it } from 'vitest';
import {
  bulkPairs,
  filterTiles,
  filterTrade,
  groupSeries,
  ownedBySet,
  ownKey,
  parseOwn,
  parseStockItems,
  percent,
  primaryVariant,
  progress,
  releaseLabel,
  searchColecao,
  secretCount,
  serieColor,
  setOfCard,
  shopCount,
  statusOf,
  tiles,
  tradeRows,
  variantsOf,
  withQty,
} from '../../src/domain/colecao';
import type { TcgCardInfo, TcgSetInfo } from '../../src/domain/enciclopedia';

const card = (id: string, name: string, variants: string | null, over: Partial<TcgCardInfo> = {}): TcgCardInfo => ({
  id,
  local_id: id.split('-')[1] ?? '',
  num: null,
  name,
  name_pt: null,
  rarity: null,
  types: null,
  variants,
  image: null,
  ...over,
});
const set = (id: string, serie_id: string, released: string | null, logo: string | null = `/${id}`): TcgSetInfo => ({
  id,
  name: id,
  name_pt: null,
  serie_id,
  serie: serie_id.toUpperCase(),
  released,
  total: 10,
  official: 8,
  logo,
});

const CARDS = [
  card('base1-4', 'Charizard', 'holo,normal,firstEdition'),
  card('base1-5', 'Clefairy', null),
  card('base1-6', 'Gyarados', 'normal'),
];

describe('posse', () => {
  it('lê [carta, variante, qtd] e descarta o que está fora do formato', () => {
    expect(
      parseOwn([
        ['sv03.5-006', 'holo', 2],
        ['base1-4', 'normal', 1],
        ['base1-4', 'holo', 0],
        ['base1-4', 'reverse', -1],
        ['base1-4', 'reverse', 1.5],
        ['base1-4', 'reverse', '2'],
        ['id inválido!', 'normal', 1],
        ['base1-4', '', 1],
        ['base1-4'],
        'texto',
        null,
      ]),
    ).toEqual({ 'sv03.5-006|holo': 2, 'base1-4|normal': 1 });
    expect(parseOwn(undefined)).toEqual({});
    expect(parseOwn({})).toEqual({});
  });

  it('a chave junta carta e variante', () => expect(ownKey('base1-4', 'holo')).toBe('base1-4|holo'));
});

describe('variantes', () => {
  it('ordena como normal, reverse, holo, 1ª edição e põe o desconhecido por último', () => {
    expect(variantsOf({ variants: 'holo,firstEdition,reverse,normal' })).toEqual([
      'normal',
      'reverse',
      'holo',
      'firstEdition',
    ]);
    expect(variantsOf({ variants: 'wPromo,holo' })).toEqual(['holo', 'wPromo']);
  });
  it('sem informação do TCGdex vale uma só: normal', () => {
    expect(variantsOf({ variants: null })).toEqual(['normal']);
    expect(variantsOf({ variants: '' })).toEqual(['normal']);
  });
  it('a variante principal é a primeira disponível', () => {
    expect(primaryVariant({ variants: 'holo,firstEdition' })).toBe('holo');
    expect(primaryVariant({ variants: null })).toBe('normal');
  });
});

describe('contas pequenas', () => {
  it('shopCount soma as unidades à venda; sem controle de estoque vale 1; null soma todas as variantes', () => {
    const shop = [
      { id: 'a', cardId: 'base1-4', lang: 'EN', variant: 'holo', grade: '', price: 1, available: 2 },
      { id: 'b', cardId: 'base1-4', lang: 'PT', variant: 'normal', grade: '', price: 1, available: null },
      { id: 'c', cardId: 'base1-5', lang: 'EN', variant: 'normal', grade: '', price: 1, available: 5 },
    ];
    expect(shopCount(shop, 'base1-4', 'holo')).toBe(2);
    expect(shopCount(shop, 'base1-4', null)).toBe(3);
    expect(shopCount(shop, 'base1-9', null)).toBe(0);
  });

  it('percent arredonda para baixo e não divide por zero', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(percent(299, 300)).toBe(99);
    expect(percent(3, 3)).toBe(100);
  });
});

describe('quadrados do set', () => {
  const own = { 'base1-4|holo': 1, 'base1-4|normal': 2, 'base1-6|normal': 1 };

  it('o estoque da loja soma ao total (qty) sem mexer na coleção (col)', () => {
    const shop = [
      { id: 'a', cardId: 'base1-5', lang: 'EN', variant: 'normal', grade: '', price: 1, available: 2 },
      { id: 'b', cardId: 'base1-4', lang: 'EN', variant: 'holo', grade: '', price: 1, available: null },
      { id: 'c', cardId: 'outro-1', lang: 'EN', variant: 'normal', grade: '', price: 1, available: 5 },
    ];
    expect(tiles(CARDS, own, false, shop).map((t) => [t.card.id, t.qty, t.col])).toEqual([
      ['base1-4', 4, 3],
      ['base1-5', 2, 0],
      ['base1-6', 1, 1],
    ]);
    expect(tiles(CARDS, own, true, shop).map((t) => `${t.card.id}|${t.variant}|${t.qty}|${t.col}`)).toEqual([
      'base1-4|normal|2|2',
      'base1-4|holo|2|1',
      'base1-4|firstEdition|0|0',
      'base1-5|normal|2|0',
      'base1-6|normal|1|1',
    ]);
  });

  it('modo simples: uma carta por quadrado, "tenho" soma as variantes', () => {
    const list = tiles(CARDS, own, false);
    expect(list.map((t) => [t.card.id, t.variant, t.qty])).toEqual([
      ['base1-4', null, 3],
      ['base1-5', null, 0],
      ['base1-6', null, 1],
    ]);
    expect(list[0]?.variants).toEqual(['normal', 'holo', 'firstEdition']);
  });

  it('modo variantes: um quadrado por variante, com a quantidade da própria variante', () => {
    const list = tiles(CARDS, own, true);
    expect(list.map((t) => `${t.card.id}|${t.variant}|${t.qty}`)).toEqual([
      'base1-4|normal|2',
      'base1-4|holo|1',
      'base1-4|firstEdition|0',
      'base1-5|normal|0',
      'base1-6|normal|1',
    ]);
    expect(list[1]?.variants).toEqual(['holo']);
  });

  it('set sem cartas dá lista vazia', () => expect(tiles([], own, true)).toEqual([]));
});

describe('estado e progresso', () => {
  it('falta, tenho e repetida', () => {
    expect([-1, 0, 1, 2, 9].map(statusOf)).toEqual(['falta', 'falta', 'tenho', 'repetida', 'repetida']);
  });

  it('conta quem tem, arredonda para baixo e só completa quando tem tudo', () => {
    const list = tiles(CARDS, { 'base1-4|normal': 1, 'base1-6|normal': 1 }, false);
    expect(progress(list)).toEqual({ have: 2, total: 3, pct: 66, complete: false });
    const all = tiles(CARDS, { 'base1-4|normal': 1, 'base1-5|normal': 1, 'base1-6|normal': 1 }, false);
    expect(progress(all)).toEqual({ have: 3, total: 3, pct: 100, complete: true });
    const almost = tiles(
      Array.from({ length: 200 }, (_, i) => card(`x-${i}`, `c${i}`, 'normal')),
      Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`x-${i}|normal`, 1])),
      false,
    );
    expect(progress(almost).pct).toBe(99);
    expect(progress(almost).complete).toBe(false);
  });

  it('set vazio não passa por completo nem divide por zero', () => {
    expect(progress([])).toEqual({ have: 0, total: 0, pct: 0, complete: false });
  });

  it('secretas = total − numeradas, nunca negativo', () => {
    expect(secretCount({ total: 130, official: 102 })).toBe(28);
    expect(secretCount({ total: 100, official: 100 })).toBe(0);
    expect(secretCount({ total: 90, official: 100 })).toBe(0);
  });
});

describe('abas e busca', () => {
  const list = tiles(
    [
      card('s-1', 'Pikachu', 'normal', { name_pt: 'Pikachu' }),
      card('s-2', 'Charizard', 'normal', { name_pt: 'Charizard' }),
      card('s-3', 'Alolan Exeggutor', 'normal', { name_pt: 'Exeggutor de Alola' }),
    ],
    { 's-1|normal': 1 },
    false,
  );

  it('todas, tenho e preciso', () => {
    expect(filterTiles(list, 'todas', '')).toHaveLength(3);
    expect(filterTiles(list, 'tenho', '').map((t) => t.card.id)).toEqual(['s-1']);
    expect(filterTiles(list, 'preciso', '').map((t) => t.card.id)).toEqual(['s-2', 's-3']);
  });

  it('busca por nome em inglês ou português, sem acento e sem diferenciar maiúsculas, e por número', () => {
    expect(filterTiles(list, 'todas', '  ALOLA ').map((t) => t.card.id)).toEqual(['s-3']);
    expect(filterTiles(list, 'todas', 'exeggutor').map((t) => t.card.id)).toEqual(['s-3']);
    expect(filterTiles(list, 'todas', '2').map((t) => t.card.id)).toEqual(['s-2']);
    expect(filterTiles(list, 'preciso', 'pikachu')).toEqual([]);
  });
});

describe('séries', () => {
  const sets = [
    set('me02', 'me', '2026-05-01'),
    set('me01', 'me', '2026-01-01', null),
    set('sv10', 'sv', '2025-06-01'),
    set('sv01', 'sv', '2023-03-01'),
    set('mystery', '', null),
  ];

  it('agrupa na ordem de aparição, com os sets do mais novo ao mais antigo', () => {
    const groups = groupSeries([sets[1], sets[0], sets[3], sets[2], sets[4]] as TcgSetInfo[]);
    expect(groups.map((g) => g.id)).toEqual(['me', 'sv', 'outros']);
    expect(groups[0]?.sets.map((s) => s.id)).toEqual(['me02', 'me01']);
    expect(groups[1]?.sets.map((s) => s.id)).toEqual(['sv10', 'sv01']);
    expect(groups[2]?.name).toBe('outros');
  });

  it('busca séries pelo nome e coleções pelo nome (EN ou PT) ou código, sem acento nem maiúsculas', () => {
    const named = [
      { ...set('sv03.5', 'sv', '2023-09-22'), name: '151', name_pt: '151' },
      { ...set('base2', 'base', '1999-06-16'), name: 'Jungle', name_pt: 'Selva' },
      { ...set('me01', 'me', '2026-01-01'), serie: 'Mega Evolution', name: 'Mega Evolution', name_pt: 'Mega Evolução' },
    ];
    const groups = groupSeries(named);
    const ids = (r: ReturnType<typeof searchColecao>) => [r.series.map((g) => g.id), r.sets.map((x) => x.id)];
    expect(ids(searchColecao(groups, ''))).toEqual([['sv', 'base', 'me'], []]);
    expect(ids(searchColecao(groups, '   '))).toEqual([['sv', 'base', 'me'], []]);
    expect(ids(searchColecao(groups, 'SELVA'))).toEqual([[], ['base2']]);
    expect(ids(searchColecao(groups, 'evolucao'))).toEqual([[], ['me01']]);
    expect(ids(searchColecao(groups, 'sv03'))).toEqual([[], ['sv03.5']]);
    expect(ids(searchColecao(groups, 'mega'))).toEqual([['me'], ['me01']]);
    expect(ids(searchColecao(groups, 'nada disso'))).toEqual([[], []]);
  });

  it('série fora da tabela não tem cor (usa o cinza do tema)', () => {
    expect(serieColor('sv')).toEqual({ bg: '#A62F87', fg: '#FFFFFF' });
    expect(serieColor('desconhecida')).toBeNull();
  });

  it('o texto de toda cor de série passa de 4,5:1 de contraste', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const id of [
      'me',
      'sv',
      'swsh',
      'sm',
      'xy',
      'bw',
      'hgss',
      'pl',
      'dp',
      'ex',
      'ecard',
      'neo',
      'gym',
      'base',
      'tcgp',
    ]) {
      const c = serieColor(id);
      const [hi, lo] = [lum(c?.bg ?? '#000000'), lum(c?.fg ?? '#000000')].sort((a, b) => b - a) as [number, number];
      expect((hi + 0.05) / (lo + 0.05), id).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('set da carta e datas', () => {
  it('o set é o id sem o número da carta, mesmo com hífen ou ponto no id do set', () => {
    expect(setOfCard('base1-4')).toBe('base1');
    expect(setOfCard('sv03.5-006')).toBe('sv03.5');
    expect(setOfCard('swsh12tg-TG01')).toBe('swsh12tg');
    expect(setOfCard('promo-set-12')).toBe('promo-set');
    expect(setOfCard('semhifen')).toBe('semhifen');
    expect(setOfCard('-1')).toBe('-1');
  });

  it('conta cartas diferentes por set, não variantes nem quantidades', () => {
    const own = { 'base1-4|normal': 3, 'base1-4|holo': 1, 'base1-5|normal': 1, 'sv03.5-006|holo': 2 };
    expect(ownedBySet(own)).toEqual(
      new Map([
        ['base1', 2],
        ['sv03.5', 1],
      ]),
    );
    expect(ownedBySet({})).toEqual(new Map());
  });

  it('data de lançamento em dia/mês/ano; sem data válida, vazio', () => {
    expect(releaseLabel('2023-09-22')).toBe('22/09/2023');
    expect(releaseLabel('2023-09-22T00:00:00Z')).toBe('22/09/2023');
    expect(releaseLabel('setembro')).toBe('');
    expect(releaseLabel('2023-9-2')).toBe('');
    expect(releaseLabel(null)).toBe('');
  });
});

describe('marcação', () => {
  it('withQty liga, atualiza e remove sem mexer no mapa original', () => {
    const own = { 'base1-4|normal': 1 };
    const more = withQty(own, 'base1-4', 'holo', 2);
    expect(more).toEqual({ 'base1-4|normal': 1, 'base1-4|holo': 2 });
    expect(own).toEqual({ 'base1-4|normal': 1 });
    expect(withQty(more, 'base1-4', 'normal', 0)).toEqual({ 'base1-4|holo': 2 });
    expect(withQty(own, 'base1-4', 'normal', -3)).toEqual({});
    expect(withQty({}, 'a-1', 'normal', 0)).toEqual({});
  });

  it('selecionar todas marca na coleção também o que só o estoque da loja cobre; desmarcar só o que está na coleção', () => {
    const shop = [{ id: 'a', cardId: 'base1-5', lang: 'EN', variant: 'normal', grade: '', price: 1, available: 2 }];
    const list = tiles(CARDS, { 'base1-4|normal': 1 }, false, shop);
    expect(bulkPairs(list, true)).toEqual([
      ['base1-5', 'normal'],
      ['base1-6', 'normal'],
    ]);
    expect(bulkPairs(list, false)).toEqual([
      ['base1-4', 'normal'],
      ['base1-4', 'holo'],
      ['base1-4', 'firstEdition'],
    ]);
    expect(bulkPairs(tiles(CARDS, {}, false, shop), false)).toEqual([]);
  });

  it('selecionar todas marca só o que falta: a variante principal no modo simples, cada variante no modo variantes', () => {
    const own = { 'base1-4|holo': 1, 'base1-6|normal': 1 };
    expect(bulkPairs(tiles(CARDS, own, false), true)).toEqual([['base1-5', 'normal']]);
    expect(bulkPairs(tiles(CARDS, own, true), true)).toEqual([
      ['base1-4', 'normal'],
      ['base1-4', 'firstEdition'],
      ['base1-5', 'normal'],
    ]);
    expect(bulkPairs(tiles(CARDS, {}, false), true)).toEqual([
      ['base1-4', 'normal'],
      ['base1-5', 'normal'],
      ['base1-6', 'normal'],
    ]);
  });

  it('desmarcar todas limpa todas as variantes dos quadrados marcados', () => {
    const own = { 'base1-4|holo': 1, 'base1-4|normal': 2, 'base1-6|normal': 1 };
    expect(bulkPairs(tiles(CARDS, own, false), false)).toEqual([
      ['base1-4', 'normal'],
      ['base1-4', 'holo'],
      ['base1-4', 'firstEdition'],
      ['base1-6', 'normal'],
    ]);
    expect(bulkPairs(tiles(CARDS, own, true), false)).toEqual([
      ['base1-4', 'normal'],
      ['base1-4', 'holo'],
      ['base1-6', 'normal'],
    ]);
    expect(bulkPairs([], false)).toEqual([]);
  });
});

describe('para trocar', () => {
  const stock = parseStockItems({
    stock: [
      { id: 'p1', cardId: 'base1-4', lang: 'EN', variant: 'holo', grade: 'PSA 8', price: 5000, available: 1 },
      { id: 'p2', cardId: 'base1-4', lang: 'PT', variant: 'normal', grade: '', price: 20, available: null },
      { id: 'p3', cardId: 'outro-1', lang: 'EN', variant: 'normal', grade: '', price: 1, available: 1 },
    ],
  });

  it('lê o estoque e descarta o que está fora do formato', () => {
    expect(stock).toHaveLength(3);
    expect(stock[1]).toEqual({
      id: 'p2',
      cardId: 'base1-4',
      lang: 'PT',
      variant: 'normal',
      grade: '',
      price: 20,
      available: null,
    });
    expect(
      parseStockItems({
        stock: [
          { id: '', cardId: 'base1-4' },
          { id: 'p', cardId: 'id inválido!' },
          { id: 'p', cardId: 'base1-4', price: -1, available: 'x', lang: 5, variant: null },
          'texto',
          null,
        ],
      }),
    ).toEqual([{ id: 'p', cardId: 'base1-4', lang: '', variant: '', grade: '', price: null, available: null }]);
    expect(parseStockItems({})).toEqual([]);
    expect(parseStockItems(null)).toEqual([]);
    expect(parseStockItems({ stock: 'x' })).toEqual([]);
  });

  it('lista só o estoque da loja, na ordem das cartas', () => {
    const rows = tradeRows(CARDS, stock);
    expect(rows.map((r) => [r.card.id, r.variant, r.qty])).toEqual([
      ['base1-4', 'holo', 1],
      ['base1-4', 'normal', null],
    ]);
    expect(rows[0]).toMatchObject({ lang: 'EN', grade: 'PSA 8', price: 5000 });
  });

  it('a busca da aba filtra por nome (EN ou PT) e número, sem acento', () => {
    const rows = tradeRows(
      [{ ...CARDS[0]!, name_pt: 'Lagarto Ígneo' }, CARDS[2]!],
      [
        { id: 'a', cardId: CARDS[0]!.id, lang: '', variant: '', grade: '', price: null, available: 1 },
        { id: 'b', cardId: CARDS[2]!.id, lang: '', variant: '', grade: '', price: null, available: 1 },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(filterTrade(rows, '').length).toBe(2);
    expect(filterTrade(rows, ' ignio ').length).toBe(0);
    expect(filterTrade(rows, 'IGNEO').map((r) => r.card.id)).toEqual(['base1-4']);
    expect(filterTrade(rows, 'gyar').map((r) => r.card.id)).toEqual(['base1-6']);
    expect(filterTrade(rows, '4').map((r) => r.card.id)).toEqual(['base1-4']);
  });

  it('sem estoque, nada para trocar', () => {
    expect(tradeRows(CARDS, [])).toEqual([]);
  });
});
