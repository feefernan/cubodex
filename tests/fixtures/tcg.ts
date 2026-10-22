/** Enciclopédia de mentira, na forma da API (/api/tcg/*), com cartas que existem no catálogo de exemplo da loja. */
export const SETS = [
  {
    id: 'sv03.5',
    name: '151',
    name_pt: '151',
    serie_id: 'sv',
    serie: 'Scarlet & Violet',
    released: '2023-09-22',
    total: 207,
    official: 165,
    logo: 'sv/sv03.5',
  },
  {
    id: 'base2',
    name: 'Jungle',
    name_pt: 'Selva',
    serie_id: 'base',
    serie: 'Base',
    released: '1999-06-16',
    total: 64,
    official: 64,
    logo: 'base/base2',
  },
  // Set sem logo, sem data, sem total oficial e com muitas cartas (a página mostra 60 por vez).
  {
    id: 'pop1',
    name: 'POP Series 1',
    name_pt: null,
    serie_id: 'pop',
    serie: '',
    released: null,
    total: 70,
    official: 0,
    logo: null,
  },
  {
    id: 'base1',
    name: 'Base Set',
    name_pt: 'Coleção Básica',
    serie_id: 'base',
    serie: 'Base',
    released: '1999-01-09',
    total: 102,
    official: 102,
    logo: 'base/base1',
  },
];

const card = (
  set: string,
  local: string,
  name: string,
  rarity: string,
  types: string,
  image: string,
  namePt: string | null = null,
) => ({
  id: `${set}-${local}`,
  local_id: local,
  num: Number(local),
  name,
  name_pt: namePt,
  rarity,
  types,
  variants: 'normal,holo',
  image: `${image}/${local}`,
});

interface FixtureCard {
  id: string;
  local_id: string;
  num: number;
  name: string;
  name_pt: string | null;
  rarity: string | null;
  types: string | null;
  variants: string | null;
  image: string | null;
}

export const CARDS: Record<string, FixtureCard[]> = {
  base1: [
    card('base1', '2', 'Blastoise', 'Rare', 'Water', 'base/base1'),
    card('base1', '4', 'Charizard', 'Rare', 'Fire', 'base/base1', 'Charizard PT'),
    card('base1', '58', 'Pikachu', 'Common', 'Lightning', 'base/base1'),
  ],
  // Sem imagem, raridade, tipos nem variantes (cartas assim existem no TCGdex).
  pop1: Array.from({ length: 70 }, (_, i) => ({
    id: `pop1-${i + 1}`,
    local_id: String(i + 1),
    num: i + 1,
    name: `Treinador ${i + 1}`,
    name_pt: null,
    rarity: null,
    types: null,
    variants: null,
    image: null,
  })),
  base2: [card('base2', '11', 'Snorlax', 'Rare', 'Colorless', 'base/base2')],
  'sv03.5': [
    card('sv03.5', '006', 'Charizard ex', 'Double rare', 'Fire', 'sv/sv03.5'),
    card('sv03.5', '025', 'Pikachu', 'Common', 'Lightning', 'sv/sv03.5'),
    card('sv03.5', '151', 'Mew ex', 'Double rare', 'Psychic', 'sv/sv03.5'),
  ],
};

/** Responde a um caminho /api/tcg/…, ou null se não for da enciclopédia. */
export const tcgApi = (path: string): { status: number; body: unknown } | null => {
  if (!path.startsWith('/api/tcg/')) return null;
  const [, , , kind, id] = path.split('/');
  if (kind === 'sets' && !id) return { status: 200, body: { sets: SETS } };
  if (kind === 'sets') {
    const set = SETS.find((s) => s.id === decodeURIComponent(id));
    return set
      ? { status: 200, body: { set, cards: CARDS[set.id] ?? [] } }
      : { status: 404, body: { error: 'Set não encontrado' } };
  }
  if (kind === 'cards') {
    const cardId = decodeURIComponent(id);
    const found = Object.values(CARDS)
      .flat()
      .find((c) => c.id === cardId);
    const set = SETS.find((s) => s.id === cardId.split('-')[0]);
    return found
      ? { status: 200, body: { card: found, set } }
      : { status: 404, body: { error: 'Carta não encontrada' } };
  }
  if (kind === 'index')
    return {
      status: 200,
      body: {
        cards: Object.values(CARDS)
          .flat()
          .map((c) => [c.id, c.name, c.name_pt ?? '', c.id.split('-')[0]]),
      },
    };
  return { status: 404, body: { error: 'Não encontrado' } };
};
