import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { tcgApi } from '../fixtures/tcg';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel) as T;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const visible = () =>
  $$('.view')
    .filter((v) => !v.hidden)
    .map((v) => v.id);
const settle = () => new Promise((r) => setTimeout(r, 0));
const goHash = async (hash: string) => {
  location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await settle();
};

/** A coleção do servidor: o que /api/colecao responde (ou o erro). */
const server = {
  reply: () => Response.json({ sets: [], items: [] }) as Response,
};

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const tcg = tcgApi(url);
      if (tcg) return Response.json(tcg.body, { status: tcg.status });
      if (url === '/api/colecao') return server.reply();
      return Response.json({ error: 'Entre' }, { status: 401 });
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  document.body.innerHTML = body;
  await import('../../src/main');
});

describe('coleção interna: quem é autorizado', () => {
  it('landing com uma série por cartão, a cor da série e o progresso das cartas', async () => {
    server.reply = () =>
      Response.json({
        sets: [],
        items: [
          ['base2-1', 'normal', 1],
          ['base2-2', 'normal', 2],
          ['base2-2', 'holo', 1],
        ],
      });
    await goHash('#/colecao');
    expect(visible()).toEqual(['v-colecao']);
    expect(document.body.className).toBe('a-colecao');
    const base = $('.cx-card[data-id="base"]');
    expect(base.getAttribute('style')).toBe('--cx-bg:#F2C230;--cx-fg:#101419');
    expect(base.querySelector('.cx-card-meta')?.textContent).toMatch(/· 2\/\d+ cartas/);
    expect($('.cx-card[data-id="sv"]').getAttribute('style')).toContain('#A62F87');
    // série fora da tabela de cores: sem estilo, o CSS usa o cinza do tema
    expect($('.cx-card[data-id="pop"]').hasAttribute('style')).toBe(false);
    expect($('#colecaoSub').textContent).toMatch(/séries · 2\/\d+ cartas/);
    expect($('#cxHead [aria-current="page"]').textContent).toBe('séries');
  });

  it('série mostra os sets com data, cartas e o anel de progresso; set leva à página do set', async () => {
    await goHash('#/colserie/base');
    expect(visible()).toEqual(['v-colserie']);
    const jungle = $('.cx-set[data-id="base2"]');
    expect(jungle.textContent).toContain('16/06/1999');
    expect(jungle.textContent).toContain('2/64 cartas');
    expect(jungle.querySelector('.cx-ring')?.getAttribute('style')).toBe('--p:3');
    expect($('#cxHead .cx-crumbs').textContent).toContain('Base');
    expect($('#cxHead .cx-back').getAttribute('href')).toBe('#/colecao');

    jungle.click();
    await settle();
    expect(visible()).toEqual(['v-colset']);
    expect($('#colsetBody').textContent).toContain('em breve');
    expect($$('#cxHead .cx-crumbs a')).toHaveLength(2);
  });

  it('série e set que não existem mostram um aviso com o caminho de volta', async () => {
    await goHash('#/colserie/naoexiste');
    expect($('#colserieBody').textContent).toContain('série não encontrada');
    await goHash('#/colset/naoexiste');
    expect($('#colsetBody').textContent).toContain('coleção não encontrada');
  });

  it('o botão de tema do cabeçalho de app troca o modo da loja', async () => {
    await goHash('#/colecao');
    const before = document.documentElement.dataset.tema;
    $('[data-action="cx-theme"]').click();
    expect(document.documentElement.dataset.tema).not.toBe(before);
  });
});

describe('coleção interna: quem não é', () => {
  it('404 do servidor vira "área restrita", sem dados', async () => {
    server.reply = () => Response.json({ error: 'Não encontrado' }, { status: 404 });
    await goHash('#/colserie/sv');
    await goHash('#/colecao');
    expect($('#colecaoBody').textContent).toContain('área restrita');
    expect($$('#colecaoBody .cx-card')).toHaveLength(0);
  });

  it('erro de rede ou do servidor oferece tentar de novo, e o retry funciona', async () => {
    server.reply = () => Response.json({ error: 'Algo deu errado.' }, { status: 502 });
    await goHash('#/colserie/sv');
    await goHash('#/colecao');
    expect($('#colecaoBody').textContent).toContain('não deu para abrir');
    server.reply = () => Response.json({ sets: [], items: [] });
    $('[data-action="cx-retry"]').click();
    await settle();
    expect($$('#colecaoBody .cx-card').length).toBeGreaterThan(0);
  });

  it('o site da loja volta ao sair da área: cabeçalho da loja e corpo sem a classe da coleção', async () => {
    await goHash('#/home');
    expect(document.body.className).not.toContain('a-colecao');
  });
});
