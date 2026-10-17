import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Monta só o botão e carrega o módulo de tema do zero, com a preferência do aparelho e o salvo indicados. */
const boot = async (saved: string | null, light: boolean | 'erro') => {
  vi.resetModules();
  document.body.innerHTML = '<button id="themeBtn" data-action="theme-toggle"></button>';
  delete document.documentElement.dataset.tema;
  localStorage.clear();
  if (saved) localStorage.setItem('cubodex-proto-tema', saved);
  window.matchMedia = vi.fn(() => {
    if (light === 'erro') throw new Error('sem matchMedia');
    return { matches: light };
  }) as unknown as typeof window.matchMedia;
  const { bindEvents } = await import('../../src/ui/dom');
  const { initTheme } = await import('../../src/ui/theme');
  bindEvents();
  initTheme();
  return document.documentElement.dataset.tema;
};

describe('modo claro e escuro (#14)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sem escolha salva, segue o aparelho; sem matchMedia, escuro', async () => {
    expect(await boot(null, true)).toBe('claro');
    expect(await boot(null, false)).toBe('escuro');
    expect(await boot(null, 'erro')).toBe('escuro');
  });

  it('escolha salva vence o aparelho; temas antigos do protótipo viram claro', async () => {
    expect(await boot('escuro', true)).toBe('escuro');
    expect(await boot('claro', false)).toBe('claro');
    expect(await boot('1c', false)).toBe('claro');
    expect(await boot('qualquer', false)).toBe('escuro');
  });
});
