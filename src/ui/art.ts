/** Mistura a cor com branco (to=255) ou preto (to=0) na proporção t. */
const mix = (hex: string, t: number, to: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (to - c) * t));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const STROKE = ' stroke="rgba(16,20,25,.3)" stroke-width=".9" stroke-linejoin="round"';

/** Cubo isométrico da marca na cor da miniatura. */
export const cube = (c: string): string =>
  `<svg viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,6 40,15 24,24 8,15" fill="${mix(c, 0.35, 255)}"${STROKE}/><polygon points="8,15 24,24 24,42 8,33" fill="${c}"${STROKE}/><polygon points="24,24 40,15 40,33 24,42" fill="${mix(c, 0.32, 0)}"${STROKE}/></svg>`;

/**
 * Desenho técnico da peça a partir das medidas reais ("90 × 60 × 28 mm"): planta em escala, cotas de largura e
 * profundidade e a altura escrita. Fica no lugar da foto até ela existir.
 */
export const plan = (measures: string): string => {
  const [w = 1, d = 1, h] = (measures.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
  const s = Math.min(150 / w, 96 / d);
  const [W, D] = [w * s, d * s];
  const x = 36 + (150 - W) / 2;
  const y = 34 + (96 - D) / 2;
  const t = (tx: number, ty: number, label: string, rot = '') =>
    `<text x="${tx}" y="${ty}" fill="currentColor" stroke="none" font-family="IBM Plex Mono, monospace" font-size="12" text-anchor="middle"${rot}>${label}</text>`;
  return (
    `<svg class="plan" viewBox="0 0 240 170" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">` +
    `<rect x="${x}" y="${y}" width="${W}" height="${D}"/>` +
    `<path d="M${x} ${y - 12}h${W}M${x + W + 12} ${y}v${D}" opacity=".6"/>` +
    t(x + W / 2, y - 18, `${w} mm`) +
    t(x + W + 26, y + D / 2, `${d} mm`, ` transform="rotate(90 ${x + W + 26} ${y + D / 2})"`) +
    (h ? t(120, 162, `altura ${h} mm`) : '') +
    '</svg>'
  );
};

const BR =
  '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#009C3B"/><polygon points="10,2 18,7 10,12 2,7" fill="#FFDF00"/><circle cx="10" cy="7" r="3" fill="#002776"/></svg>';
const US =
  '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#FFFFFF"/><g fill="#B22234"><rect width="20" height="2"/><rect y="4" width="20" height="2"/><rect y="8" width="20" height="2"/><rect y="12" width="20" height="2"/></g><rect width="9" height="8" fill="#3C3B6E"/></svg>';

export const flag = (lang: string): string =>
  `<span class="flag" title="${lang === 'PT' ? 'português' : 'inglês'}">${lang === 'PT' ? BR : US}<span class="mono">${lang}</span></span>`;

export const emptyState = (title: string, text: string, extra = '', style = '') =>
  `<div class="empty"${style ? ` style="${style}"` : ''}><h3 class="display">${title}</h3><p>${text}</p>${extra}</div>`;
