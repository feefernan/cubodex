import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS, PRODUCTS, productById } from '../../src/domain/catalog';
import { applyStock } from '../../src/domain/stock';
import { itemTile, productTile } from '../../src/ui/tiles';

const everything = PRODUCTS.map((p) => ({
  id: p.id,
  price: p.price,
  available: p.kind === 'item' ? p.qty : null,
  active: p.kind !== 'item' || p.status !== 'esgotado',
  presale: p.kind === 'item' && p.status === 'prevenda',
}));
const withPhoto = (id: string, key: string) =>
  applyStock(everything.map((r) => (r.id === id ? { ...r, photos: [key] } : r)));
afterEach(() => applyStock(everything));

describe('foto própria nas vitrines', () => {
  it('carta: a foto própria tem prioridade; sem ela, a imagem oficial do TCGdex', () => {
    const item = ITEMS.find((i) => i.id === 'i2');
    if (!item) throw new Error('i2 sumiu do catálogo de exemplo');
    expect(itemTile(item)).toContain('https://assets.tcgdex.net/en/base/base1/2/low.webp');
    withPhoto('i2', 'fotos/i2/0123456789abcdef.jpg');
    const html = itemTile(ITEMS.find((i) => i.id === 'i2') ?? item);
    expect(html).toContain('src="/api/img/fotos/i2/0123456789abcdef.jpg"');
    expect(html).not.toContain('assets.tcgdex.net');
  });

  it('peça, acessório e miniatura: a foto troca o desenho e leva o nome como texto alternativo', () => {
    expect(productTile(productById.k1)).toContain('class="plan"');
    expect(productTile(productById.m1)).toContain('media--mini');
    expect(productTile(productById.a1)).toContain('media--sq ph');
    for (const id of ['k1', 'm1', 'a1']) {
      withPhoto(id, `fotos/${id}/0123456789abcdef.png`);
      const html = productTile(productById[id]);
      expect(html).toContain(`src="/api/img/fotos/${id}/0123456789abcdef.png"`);
      expect(html).toContain(`alt="${productById[id].name}"`);
      expect(html).not.toContain('class="plan"');
    }
  });
});
