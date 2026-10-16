const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para interpolação segura em HTML (conteúdo e atributos entre aspas). */
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (ch) => ENTITIES[ch]);

export const brl = (n: number): string => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Número de 3 dígitos da Dex: 7 → "007". */
export const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Minúsculas e sem acentos, para busca. */
export const normalize = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const uniq = <T>(list: T[]): T[] => list.filter((v, i) => list.indexOf(v) === i);
