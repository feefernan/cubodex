import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS, productById } from '../../src/domain/catalog';
import { applyStock } from '../../src/domain/stock';
import { itemTile, productTile } from '../../src/ui/tiles';
import { everything, resetCatalog } from '../catalog';

const withPhoto = (id: string, key: string) =>
  applyStock(everything.map((r) => (r.id === id ? { ...r, photos: [key] } : r)));
afterEach(resetCatalog);

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

  it('acessório e selado com 2 ou 3 fotos: faixa com uma imagem e um ponto por foto; com 1, a foto simples', () => {
    const three = ['a', 'b', 'c'].map((c) => `fotos/a1/000000000000000${c === 'a' ? '1' : c === 'b' ? '2' : '3'}.png`);
    applyStock(
      everything.map((r) => (r.id === 'a1' ? { ...r, photos: [...three, 'fotos/a1/0000000000000004.png'] } : r)),
    );
    const html = productTile(productById.a1);
    expect(html).toContain('gallery-track');
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html.match(/<i( class="on")?><\/i>/g)).toHaveLength(3);
    expect(html).toContain('(foto 2 de 3)');
    expect(html).toContain('aria-label="Fotos de ');
    withPhoto('a1', 'fotos/a1/0123456789abcdef.png');
    expect(productTile(productById.a1)).not.toContain('gallery');
    // Miniatura e peça não têm faixa: só acessórios e selados.
    applyStock(everything.map((r) => (r.id === 'k1' ? { ...r, photos: three } : r)));
    expect(productTile(productById.k1)).not.toContain('gallery');
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
