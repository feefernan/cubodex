import { describe, expect, it } from 'vitest';
import {
  filterTiles,
  groupSeries,
  ownKey,
  parseOwn,
  primaryVariant,
  progress,
  secretCount,
  serieColor,
  statusOf,
  tiles,
  variantsOf,
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

describe('quadrados do set', () => {
  const own = { 'base1-4|holo': 1, 'base1-4|normal': 2, 'base1-6|normal': 1 };

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

  it('o logo da série é o do set mais novo que tem logo; sem nenhum, null', () => {
    expect(groupSeries(sets)[0]?.logo).toBe('/me02');
    expect(groupSeries([set('a', 'x', '2020-01-01', null)])[0]?.logo).toBeNull();
    expect(groupSeries([set('a', 'x', null, null), set('b', 'x', '2021-01-01', '/b')])[0]?.logo).toBe('/b');
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
