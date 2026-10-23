import { ITEMS, type Item, isListed, itemName, PRODUCTS } from './catalog';

/** Uma novidade da home: o que é, o título e a linha de apoio, com o destino do clique. */
export interface NewsCard {
  tag: string;
  title: string;
  sub: string;
  view: 'carta' | 'criar';
  id: string | null;
}

const gradeText = (it: Item) => (it.grade ? `${it.grade.co} ${it.grade.n} · ` : '');
const stockText = (it: Item) =>
  it.status === 'prevenda' ? 'pré-venda' : it.qty === 1 ? 'última unidade' : `${it.qty} un.`;

/**
 * Novidades da home vêm do catálogo (que o Notion governa), nunca escritas à mão: a carta à venda mais recente
 * e a peça de "criar" mais nova (as novas entram no fim da lista). Sem o item, a novidade some.
 */
export const homeNews = (): NewsCard[] => {
  const cards: NewsCard[] = [];
  const item = ITEMS.filter((it) => it.status !== 'esgotado').sort((a, b) => a.added - b.added)[0];
  if (item) {
    cards.push({
      tag: `novidade · ${item.card.setName}`,
      title: `${itemName(item)} · ${item.variant}`,
      sub: `${gradeText(item)}${stockText(item)}`,
      view: 'carta',
      id: item.card.id,
    });
  }
  const craft = PRODUCTS.filter((p) => p.kind === 'craft' && isListed(p)).at(-1);
  if (craft?.kind === 'craft') {
    const spec = (k: string) => craft.spec.find(([name]) => name === k)?.[1];
    cards.push({
      tag: 'novo em criar',
      title: craft.name,
      sub: [spec('material'), spec('medidas')].filter(Boolean).join(' · '),
      view: 'criar',
      id: null,
    });
  }
  return cards;
};
