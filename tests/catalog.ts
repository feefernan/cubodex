/** Catálogo de exemplo como o Notion o teria, e o jeito de voltar a ele: o catálogo é do módulo, então os testes o restauram. */
import { DEFAULT_PACK_DISCOUNT, MINIS, type Mini, PRODUCTS, productById } from '../src/domain/catalog';
import { applyStock } from '../src/domain/stock';

export const everything = PRODUCTS.map((p) => ({
  id: p.id,
  price: p.price,
  available: p.kind === 'item' ? p.qty : null,
  active: p.kind !== 'item' || p.status !== 'esgotado',
  presale: p.kind === 'item' && p.status === 'prevenda',
}));

export const packRow = (discount: number) => ({
  id: 'pack',
  price: null,
  available: null,
  active: true,
  presale: false,
  def: { kind: 'pack' as const, discount },
});

/** Ids que os testes criam só pelo Notion; saem do catálogo na restauração. */
const ADDED = ['m13', 'k7', 'a5'];

export const resetCatalog = () => {
  applyStock([...everything, packRow(DEFAULT_PACK_DISCOUNT)]);
  for (const id of ADDED) {
    const p = productById[id];
    if (!p) continue;
    PRODUCTS.splice(PRODUCTS.indexOf(p), 1);
    delete productById[id];
  }
  MINIS.length = 0;
  MINIS.push(...PRODUCTS.filter((p): p is Mini => p.kind === 'mini'));
};
