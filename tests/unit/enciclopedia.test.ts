import { describe, expect, it } from 'vitest';
import {
  cardImageUrl,
  filterCardList,
  filterSetList,
  groupBySerie,
  logoUrl,
  numberLabel,
  parseCardInfo,
  parseIndex,
  parseSet,
  parseSets,
  searchIndex,
  setTitle,
  setYear,
  setYears,
} from '../../src/domain/enciclopedia';
import { CARDS, SETS } from '../fixtures/tcg';

const sets = parseSets({ sets: SETS });
const base1 = sets.find((s) => s.id === 'base1');
if (!base1) throw new Error('fixture sem base1');

describe('formato da API', () => {
  it('só aceita o que tem id, nome e número; o resto vira valor seguro', () => {
    expect(parseSet({ id: 'a', name: 'A' })).toEqual({
      id: 'a',
      name: 'A',
      name_pt: null,
      serie_id: '',
      serie: '',
      released: null,
      total: 0,
      official: 0,
      logo: null,
    });
    expect(parseSet({ id: 'a' })).toBeNull();
    expect(parseSet(null)).toBeNull();
    expect(parseSet({ id: 'a', name: 'A', total: -5, official: 'x' })).toMatchObject({ total: 0, official: 0 });
    expect(parseSets({ sets: [SETS[0], { x: 1 }] })).toHaveLength(1);
    expect(parseSets('lixo')).toEqual([]);
    expect(parseCardInfo({ id: 'a-1', local_id: '1', name: 'X' })).toMatchObject({
      num: null,
      rarity: null,
      image: null,
    });
    expect(parseCardInfo({ id: 'a-1', local_id: '1', name: 'X', num: 1 })?.num).toBe(1);
    expect(parseCardInfo({ id: 'a-1', name: 'X' })).toBeNull();
  });

  it('o índice só aceita entradas [id, nome, nome pt, set] de texto', () => {
    expect(parseIndex({ cards: [['a-1', 'A', '', 'a'], ['b'], [1, 2, 3, 4], 'x'] })).toEqual([['a-1', 'A', '', 'a']]);
    expect(parseIndex(null)).toEqual([]);
  });
});

describe('imagens e rótulos', () => {
  it('endereços no CDN do TCGdex', () => {
    expect(cardImageUrl('base/base1/4')).toBe('https://assets.tcgdex.net/en/base/base1/4/low.webp');
    expect(cardImageUrl('base/base1/4', 'high')).toBe('https://assets.tcgdex.net/en/base/base1/4/high.webp');
    expect(cardImageUrl('sv/sv03.5/006', 'low', 'pt')).toBe('https://assets.tcgdex.net/pt/sv/sv03.5/006/low.webp');
    expect(logoUrl('base/base1')).toBe('https://assets.tcgdex.net/en/base/base1/logo.webp');
  });
  it('nome do set com o português ao lado quando difere; número sobre o total oficial', () => {
    expect(setTitle(base1)).toBe('Base Set · Coleção Básica');
    expect(setTitle(sets[0])).toBe('151'); // português igual ao inglês
    expect(setYear(base1)).toBe('1999');
    expect(setYear({ ...base1, released: null })).toBe('');
    const charizard = parseCardInfo(CARDS.base1[1]);
    if (!charizard) throw new Error('fixture sem carta');
    expect(numberLabel(charizard, base1)).toBe('4/102');
    expect(numberLabel(charizard, { ...base1, official: 0 })).toBe('4');
  });
});

describe('lista de sets', () => {
  it('agrupa por série na ordem da API e lista os anos do mais novo ao mais antigo', () => {
    expect(groupBySerie(sets).map((g) => [g.serie, g.sets.length])).toEqual([
      ['Scarlet & Violet', 1],
      ['Base', 2],
      ['outros', 1], // set sem série
    ]);
    expect(groupBySerie([{ ...base1, serie: '' }])[0].serie).toBe('outros');
    expect(setYears(sets)).toEqual(['2023', '1999']);
  });
  it('filtra por texto (inglês, português ou série, sem acento) e por ano', () => {
    expect(filterSetList(sets, 'selva', '').map((s) => s.id)).toEqual(['base2']);
    expect(filterSetList(sets, 'colecao basica', '').map((s) => s.id)).toEqual(['base1']);
    expect(filterSetList(sets, 'scarlet', '').map((s) => s.id)).toEqual(['sv03.5']);
    expect(filterSetList(sets, '', '1999')).toHaveLength(2);
    expect(filterSetList(sets, 'xyz', '')).toEqual([]);
  });
});

describe('cartas de um set e busca', () => {
  const cards = CARDS.base1.flatMap((c) => parseCardInfo(c) ?? []);
  it('filtra por raridade e por texto (nome, português ou número)', () => {
    expect(filterCardList(cards, '', 'Common').map((c) => c.local_id)).toEqual(['58']);
    expect(filterCardList(cards, 'char', '').map((c) => c.local_id)).toEqual(['4']);
    expect(filterCardList(cards, 'charizard pt', '').map((c) => c.local_id)).toEqual(['4']);
    expect(filterCardList(cards, '58', '')).toHaveLength(1);
    expect(filterCardList(cards, '', '')).toHaveLength(3);
  });
  it('a busca global exige 2 letras, acha pelo nome em inglês ou português e põe quem começa pelo texto antes', () => {
    const index = parseIndex({
      cards: [
        ['a-1', 'Mr. Mime', '', 'a'],
        ['a-2', 'Mime Jr.', '', 'a'],
        ['b-1', 'Pikachu', 'Pikachu PT', 'b'],
      ],
    });
    expect(searchIndex(index, 'p')).toEqual([]);
    expect(searchIndex(index, 'mime').map((e) => e[0])).toEqual(['a-2', 'a-1']); // começa por "mime" antes de "mr. mime"
    expect(searchIndex(index, 'pt').map((e) => e[0])).toEqual(['b-1']); // nome em português
    expect(searchIndex(index, 'PÍKA').map((e) => e[0])).toEqual(['b-1']); // sem acento nem caixa
    expect(searchIndex(index, 'mime', 1)).toHaveLength(1);
    expect(searchIndex(index, 'nada')).toEqual([]);
  });
});
