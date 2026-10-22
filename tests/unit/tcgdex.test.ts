import { describe, expect, it } from 'vitest';
import {
  CARD_COLUMNS,
  cardRow,
  changed,
  imagePath,
  rowHash,
  SET_COLUMNS,
  setRow,
  upsertSql,
} from '../../src/domain/tcgdex';

const RAW_SET = {
  id: 'sv03.5',
  name: '151',
  releaseDate: '2023-09-22',
  logo: 'https://assets.tcgdex.net/en/sv/sv03.5/logo',
  symbol: 'https://assets.tcgdex.net/univ/sv/sv03.5/symbol',
  serie: { id: 'sv', name: 'Scarlet & Violet' },
  cardCount: { total: 207, official: 165 },
};
const RAW_CARD = {
  id: 'sv03.5-006',
  localId: '006',
  name: 'Charizard ex',
  image: 'https://assets.tcgdex.net/en/sv/sv03.5/006',
  rarity: 'Double rare',
  category: 'Pokemon',
  types: ['Fire'],
  variants: { normal: false, reverse: false, holo: true, firstEdition: false },
  set: { id: 'sv03.5' },
};

describe('imagem no CDN', () => {
  it('guarda só o caminho: sem endereço, idioma, /logo, /symbol nem extensão', () => {
    expect(imagePath('https://assets.tcgdex.net/en/sv/sv03.5/006')).toBe('sv/sv03.5/006');
    expect(imagePath('https://assets.tcgdex.net/pt/base/base1/4')).toBe('base/base1/4');
    expect(imagePath('https://assets.tcgdex.net/en/base/base1/logo')).toBe('base/base1');
    expect(imagePath('https://assets.tcgdex.net/univ/base/base3/symbol')).toBe('base/base3');
    expect(imagePath('https://assets.tcgdex.net/en/base/base1/4/high.webp')).toBe('base/base1/4/high');
    expect(imagePath('https://outro.site/en/x/y')).toBeNull();
    expect(imagePath(null)).toBeNull();
  });
});

describe('sets', () => {
  it('mapeia o set do GraphQL e junta o nome em português', () => {
    expect(setRow(RAW_SET, '151')).toEqual({
      id: 'sv03.5',
      name: '151',
      name_pt: '151',
      serie_id: 'sv',
      serie: 'Scarlet & Violet',
      released: '2023-09-22',
      total: 207,
      official: 165,
      logo: 'sv/sv03.5',
      symbol: 'sv/sv03.5',
    });
  });
  it('aceita set sem série, data ou contagem, e recusa o que não tem id ou nome', () => {
    expect(setRow({ id: 'x1', name: 'X', releaseDate: 'ontem' }, null)).toMatchObject({
      serie: '',
      released: null,
      total: 0,
      official: 0,
      logo: null,
    });
    expect(setRow({ name: 'sem id' }, null)).toBeNull();
    expect(setRow({ id: 'a', name: '' }, null)).toBeNull();
    expect(setRow({ id: "a'; DROP TABLE x;--", name: 'x' }, null)).toBeNull();
  });
});

describe('cartas', () => {
  it('mapeia raridade, tipos, variantes e número; guarda o nome em português só se for diferente', () => {
    expect(cardRow(RAW_CARD, 'sv03.5', 'Charizard ex')).toEqual({
      id: 'sv03.5-006',
      set_id: 'sv03.5',
      local_id: '006',
      num: 6,
      name: 'Charizard ex',
      name_pt: null, // igual ao inglês
      rarity: 'Double rare',
      category: 'Pokemon',
      types: 'Fire',
      variants: 'holo',
      image: 'sv/sv03.5/006',
    });
    expect(cardRow(RAW_CARD, 'sv03.5', 'Charizard EX')?.name_pt).toBe('Charizard EX');
  });
  it('número nulo em "TG01", sem imagem, sem raridade, sem tipos', () => {
    const row = cardRow(
      { id: 'swsh9tg-TG01', localId: 'TG01', name: 'Trainer', set: { id: 'swsh9tg' } },
      'swsh9tg',
      null,
    );
    expect(row).toMatchObject({ num: null, image: null, rarity: null, types: null, variants: null });
  });
  it('descarta carta de outro set (o filtro do TCGdex é por trecho do id) e carta incompleta', () => {
    expect(cardRow({ ...RAW_CARD, set: { id: 'sv03' } }, 'sv03.5', null)).toBeNull();
    expect(cardRow({ ...RAW_CARD, name: '' }, 'sv03.5', null)).toBeNull();
    expect(cardRow({ ...RAW_CARD, localId: undefined }, 'sv03.5', null)).toBeNull();
    expect(cardRow({ ...RAW_CARD, id: undefined }, 'sv03.5', null)).toBeNull();
  });
});

describe('só o que mudou', () => {
  const sets = [setRow(RAW_SET, null), setRow({ id: 'base1', name: 'Base Set' }, null)].flatMap((s) => (s ? [s] : []));
  it('o hash é estável e muda com o conteúdo', () => {
    expect(rowHash(sets[0])).toBe(rowHash({ ...sets[0] }));
    expect(rowHash(sets[0])).not.toBe(rowHash({ ...sets[0], name: 'outro' }));
    expect(rowHash(sets[0])).toMatch(/^[0-9a-f]{8}$/);
  });
  it('linha nova ou alterada entra; a igual não', () => {
    const first = changed(sets, new Map());
    expect(first.map((r) => r.id)).toEqual(['sv03.5', 'base1']);
    const stored = new Map(first.map((r) => [r.id, r.h]));
    expect(changed(sets, stored)).toEqual([]);
    stored.set('base1', 'velho');
    expect(changed(sets, stored).map((r) => r.id)).toEqual(['base1']);
  });
  it('monta o upsert com um ? por coluna e atualiza tudo menos o id', () => {
    const sql = upsertSql('tcg_sets', SET_COLUMNS);
    expect(sql.match(/\?/g)).toHaveLength(SET_COLUMNS.length);
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET name = excluded.name');
    expect(sql).not.toContain('id = excluded.id');
    expect(upsertSql('tcg_cards', CARD_COLUMNS)).toContain('INSERT INTO tcg_cards (id, set_id,');
  });
});
