import { MINIS } from './catalog';

export type DexStatus = 'have' | 'want';
export type Dex = Record<string, DexStatus>;
export type DexFilter = 'todos' | 'tenho' | 'quero' | 'faltam';

export interface VaultEntry {
  id: string;
  /** Produto do catálogo (contas reais); a demo não tem. */
  productId?: string;
  name: string;
  meta: string;
  date: string;
  qty: number;
  st: 'cofre' | 'envio' | 'enviado';
}
export interface HistoryEntry {
  d: string;
  t: string;
}

export const dexTotals = (dex: Dex) => ({
  total: MINIS.length,
  have: MINIS.filter((p) => dex[p.id] === 'have').length,
  want: MINIS.filter((p) => dex[p.id] === 'want').length,
  items: MINIS,
});

/** Marca/desmarca: clicar de novo no mesmo status limpa. Muda `dex`. */
export const toggleDex = (dex: Dex, id: string, st: DexStatus) => {
  if (dex[id] === st) delete dex[id];
  else dex[id] = st;
};

export const filterDex = (dex: Dex, f: DexFilter) =>
  MINIS.filter((p) => {
    const s = dex[p.id];
    return (
      f === 'todos' ||
      (f === 'tenho' && s === 'have') ||
      (f === 'quero' && s === 'want') ||
      (f === 'faltam' && s !== 'have')
    );
  });

export const selectedInVault = (vault: VaultEntry[], sel: Record<string, boolean>) =>
  vault.filter((v) => v.st === 'cofre' && sel[v.id]);

/** Pede o envio dos itens selecionados: viram "envio" e entram no histórico. Muda `vault` e `hist`. */
export const requestShipment = (
  vault: VaultEntry[],
  hist: HistoryEntry[],
  sel: Record<string, boolean>,
  date: string,
) => {
  const chosen = selectedInVault(vault, sel);
  for (const v of chosen) {
    v.st = 'envio';
    hist.unshift({ d: date, t: `pedido de envio · ${v.name}` });
  }
  return chosen.length;
};

const DEX_ID = /^[a-z0-9-]{1,40}$/;

/**
 * Dex vinda de fora (navegador ou API): ids bem formados e status conhecidos. Não confere se a miniatura existe
 * no catálogo (que agora vem do Notion e chega depois da página): uma miniatura que sai de venda não apaga a marca,
 * e as contas (`dexTotals`) só contam as que existem.
 */
export const parseDex = (v: unknown): Dex => {
  const dex: Dex = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return dex;
  for (const [id, st] of Object.entries(v).slice(0, 500))
    if (DEX_ID.test(id) && (st === 'have' || st === 'want')) dex[id] = st as DexStatus;
  return dex;
};
