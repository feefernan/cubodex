import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FEATURES } from '../../src/domain/features';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel) as T;
const visible = () => [...document.querySelectorAll<HTMLElement>('.view')].filter((v) => !v.hidden).map((v) => v.id);
const goTo = (view: string) => $(`[data-action="go"][data-view="${view}"]`).click();
const hash = (h: string) => {
  location.hash = h;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};

beforeAll(async () => {
  FEATURES.colecionaveis = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/me'
        ? Response.json({ error: 'Entre' }, { status: 401 })
        : Response.json({ error: 'não encontrado' }, { status: 404 }),
    ),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  localStorage.setItem(
    'cubodex-proto-v1',
    JSON.stringify({
      cart: [
        { id: 'm1', qty: 1 },
        { id: 'pack-1', qty: 1, pack: ['m1', 'm2', 'm3'] },
        { id: 'a1', qty: 1 },
      ],
    }),
  );
  document.body.innerHTML = body;
  await import('../../src/main');
});

describe('com os colecionáveis desligados', () => {
  it('a home não mostra a parte de colecionáveis, a Dex nem o card de lançamento', () => {
    expect(visible()).toEqual(['v-home']);
    expect(document.querySelector('#hl-col')).toBeNull();
    expect(document.querySelector('[data-feature="colecionaveis"]')).toBeNull();
    expect($('#news').textContent).not.toMatch(/fiozinho|série 01/);
    expect(document.querySelector('#subnav [data-sub="colecionaveis"]')).toBeNull();
    expect($('.door-col').getAttribute('href')).toBe('#/tcg');
    expect($('#v-home').textContent).not.toMatch(/fiozinho|\bdex\b|séries|série 01/i);
  });

  it('endereços antigos levam ao TCG e o voltar não repete', () => {
    for (const h of ['#/colecionaveis', '#/serie', '#serie', '#/dex', '#/colecionar']) {
      hash(h);
      expect(visible(), h).toEqual(['v-tcg']);
      expect(location.hash, h).toBe('#/tcg');
    }
    goTo('dex');
    expect(visible()).toEqual(['v-tcg']);
  });

  it('o menu colecionar abre o TCG, e criar e o cofre continuam', () => {
    hash('#/');
    $('[data-nav="col"]').click();
    expect(visible()).toEqual(['v-tcg']);
    expect($('#v-tcg .tcgnav [aria-current="page"]').textContent).toBe('cartas à venda');
    expect(document.querySelector('.colnav [data-view="dex"]')).toBeNull();
    goTo('criar');
    expect(visible()).toEqual(['v-criar']);
    goTo('cofre');
    expect(visible()).toEqual(['v-cofre']);
  });

  it('miniatura e pacote que já estavam no carrinho saem, com o aviso; o resto fica', () => {
    goTo('carrinho');
    expect(visible()).toEqual(['v-carrinho']);
    expect(JSON.parse(localStorage.getItem('cubodex-proto-v1') ?? '{}').cart).toEqual([{ id: 'a1', qty: 1 }]);
    expect(document.body.textContent).toContain('2 itens esgotaram e saíram do carrinho');
    expect($('#cartBody').textContent).not.toMatch(/pacote fiozinho/);
  });
});
