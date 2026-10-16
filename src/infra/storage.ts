import type { PersistedState } from '../domain/state';

const STATE_KEY = 'cubodex-proto-v1';
const THEME_KEY = 'cubodex-proto-tema';

// localStorage pode lançar (aba privada, cota, site data bloqueado): o site segue funcionando sem salvar.
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: só não persiste */
  }
};

export const loadState = (): unknown => {
  const raw = read(STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveState = (s: PersistedState) =>
  write(STATE_KEY, JSON.stringify({ user: s.user, cart: s.cart, dex: s.dex, vault: s.vault, hist: s.hist }));

export const loadTheme = () => read(THEME_KEY);
export const saveTheme = (id: string) => write(THEME_KEY, id);
