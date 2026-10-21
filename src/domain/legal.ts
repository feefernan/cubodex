/**
 * Quem vende (Decreto 7.962/2013: razão social, CNPJ, endereço físico e eletrônico visíveis na loja).
 * O rodapé do index.html repete estes valores como HTML estático (para quem não roda script); o teste confere.
 */
export const STORE = {
  legalName: '69.667.705 FELIPE FERNANDES CORREIA',
  tradeName: 'Cubodex',
  cnpj: '69.667.705/0001-63',
  address: 'Alameda Fernão Cardim, 310 – Jardim Paulista, São Paulo/SP',
  email: 'contato@acubodex.com.br',
  instagram: '@cubodex',
} as const;

/** Data da última revisão dos textos de ajuda (termos, privacidade, trocas). */
export const LEGAL_UPDATED = '21 de outubro de 2026';

/** Prazo do arrependimento em compra à distância (CDC, art. 49), em dias corridos, a partir do recebimento. */
export const WITHDRAWAL_DAYS = 7;
