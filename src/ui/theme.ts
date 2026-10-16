import { loadTheme, saveTheme } from '../infra/storage';
import { $, onAction, onInput } from './dom';
import { refresh } from './router';
import { S } from './store';

// shortcut: seletor de tema do protótipo, para escolher a paleta final — sai em #14.
const THEMES = [
  { id: 'escuro', note: 'original, preto cubodex', bg: '#101419', ac: '#F42744' },
  { id: '1a', note: 'cinza frio · cards brancos', bg: '#EEF1F4', ac: '#F42744' },
  { id: '1b', note: 'creme quente', bg: '#F5F2EC', ac: '#E5233F' },
  { id: '1c', note: 'cinza suave · tons amenos', bg: '#E9EAEC', ac: '#D9384F' },
  { id: '1d', note: 'branco puro', bg: '#FFFFFF', ac: '#F42744' },
];

let tema = 'escuro';
const themeById = (id: string | null) => THEMES.find((t) => t.id === id) ?? THEMES[0];

const renderThemer = () => {
  const cur = themeById(tema);
  const sw = $('#themerSw');
  sw.style.background = cur.bg;
  sw.style.setProperty('--sa', cur.ac);
  $('#themerLbl').textContent = `tema · ${cur.id}`;
  $('#themerPanel').innerHTML =
    THEMES.map(
      (t) =>
        `<button class="themer-opt" type="button" data-action="set-theme" data-id="${t.id}" aria-pressed="${t.id === tema}"><span class="sw" style="background:${t.bg};--sa:${t.ac}"></span><span><b>${t.id}</b><span class="mono">${t.note}</span></span></button>`,
    ).join('') +
    `<label class="check themer-img"><input type="checkbox" data-input="toggle-images"${S.img ? ' checked' : ''}><span>mostrar imagens do tcgdex</span></label>`;
};

const setTheme = (id: string | null, persist: boolean) => {
  tema = themeById(id).id;
  document.documentElement.dataset.tema = tema;
  if (persist) saveTheme(tema);
  renderThemer();
};

const togglePanel = (open?: boolean) => {
  const panel = $('#themerPanel');
  const o = open ?? panel.hidden;
  panel.hidden = !o;
  $('#themerBtn').setAttribute('aria-expanded', String(o));
};

const prefersLight = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
};

export const initTheme = () => {
  onAction('themer', () => togglePanel());
  onAction('set-theme', (el) => {
    setTheme(el.dataset.id ?? null, true);
    togglePanel(false);
  });
  onInput('toggle-images', (el) => {
    S.img = (el as HTMLInputElement).checked;
    refresh();
  });
  // Clique fora do seletor fecha o painel.
  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('#themer')) togglePanel(false);
  });
  setTheme(loadTheme() ?? (prefersLight() ? '1a' : 'escuro'), false);
};
