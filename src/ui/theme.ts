import { loadTheme, saveTheme } from '../infra/storage';
import { $, onAction } from './dom';

type Mode = 'claro' | 'escuro';

const prefersLight = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
};

/** Escolha salva; valores antigos do protótipo (1a–1d) contam como claro. Sem escolha, segue o aparelho. */
const savedMode = (): Mode | null => {
  const t = loadTheme();
  if (t === 'escuro' || t === 'claro') return t;
  return t && /^1[a-d]$/.test(t) ? 'claro' : null;
};

const ICON = {
  // Lua: aparece no modo claro (vai para o escuro). Sol: aparece no modo escuro (vai para o claro).
  escuro:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  claro:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};

const apply = (mode: Mode) => {
  document.documentElement.dataset.tema = mode;
  const next: Mode = mode === 'claro' ? 'escuro' : 'claro';
  const btn = $('#themeBtn');
  btn.dataset.mode = mode;
  btn.setAttribute('aria-label', `Mudar para o modo ${next}`);
  btn.innerHTML = `${ICON[next]}<span class="lbl">modo ${next}</span>`;
};

export const initTheme = () => {
  onAction('theme-toggle', (el) => {
    const mode: Mode = el.dataset.mode === 'claro' ? 'escuro' : 'claro';
    saveTheme(mode);
    apply(mode);
  });
  apply(savedMode() ?? (prefersLight() ? 'claro' : 'escuro'));
};
