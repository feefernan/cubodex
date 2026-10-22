import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCTS } from '../../src/domain/catalog';
import { homeNews } from '../../src/domain/news';
import { applyStock } from '../../src/domain/stock';

const everything = PRODUCTS.map((p) => ({
  id: p.id,
  price: p.price,
  available: p.kind === 'item' ? p.qty : null,
  active: p.kind !== 'item' || p.status !== 'esgotado',
  presale: p.kind === 'item' && p.status === 'prevenda',
}));
afterEach(() => applyStock(everything));

describe('novidades da home', () => {
  it('vêm do catálogo: a carta à venda mais recente e a peça de criar mais nova', () => {
    const [carta, peca] = homeNews();
    // i9 (mew ex, pré-venda) é a mais recente; k6 é a última peça da lista.
    expect(carta).toEqual({
      tag: 'novidade · 151',
      title: 'mew ex 151/165 · holo',
      sub: 'pré-venda',
      view: 'carta',
      id: 'sv151-151',
    });
    expect(peca).toEqual({
      tag: 'novo em criar',
      title: 'gaveta modular de miniaturas',
      sub: 'PLA · 120 × 120 × 60 mm',
      view: 'criar',
      id: null,
    });
  });
  it('mostra a quantidade e a gradação, e some quando o item sai de venda', () => {
    applyStock(everything.map((r) => (r.id === 'i9' ? { ...r, active: false } : r)));
    // sem i9, a mais recente passa a ser i8 (4 un., sem gradação)
    expect(homeNews()[0]).toMatchObject({ title: 'charizard ex 6/165 · normal', sub: '4 un.', id: 'sv151-6' });
    applyStock(everything.map((r) => (['i9', 'i8'].includes(r.id) ? { ...r, active: false } : r)));
    // sem i8 também: i1 (1 un., PSA 8) → "última unidade"
    expect(homeNews()[0]).toMatchObject({ sub: 'PSA 8 · última unidade' });
    // nada no Notion: nenhuma novidade (as cartas saem de venda também na lista de itens)
    applyStock([]);
    expect(homeNews()).toEqual([]);
  });
});
