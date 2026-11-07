import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  /** PUTs (marcar): o que o site mandou, se o servidor falha e, se houver, uma espera antes de responder. */
  sent: [] as { url: string; body: Record<string, unknown> }[],
  putFails: false,
  hold: null as Promise<void> | null,
  /** Estoque da loja (GET /api/colecao/estoque): a resposta, quantos pedidos vieram e uma espera opcional. */
  stock: () => Response.json({ stock: [] }) as Response,
  stockCalls: 0,
  stockHold: null as Promise<void> | null,
  /** Ajuste de estoque (PUT /api/colecao/estoque/:id): quantas unidades ficam, ou o erro. */
  adjust: (_delta: number): Response => Response.json({ available: 0 }),
  /** Troca (POST /api/colecao/troca): o corpo recebido e a resposta. */
  trade: (_body: Record<string, unknown>): Response => Response.json({ gave: [], got: [] }),
  tradeSent: [] as Record<string, unknown>[],
  /** Prefixo de /api/tcg/… que falha (para testar a busca e a abertura da carta recebida). */
  tcgDown: null as string | null,
};

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT') {
        server.sent.push({ url, body: JSON.parse(String(init.body)) });
        await server.hold;
        if (url.startsWith('/api/colecao/estoque/')) return server.adjust(JSON.parse(String(init.body)).delta);
        return server.putFails
          ? Response.json({ error: 'banco fora do ar' }, { status: 500 })
          : Response.json({ ok: true });
      }
      if (init?.method === 'POST' && url === '/api/colecao/troca') {
        const body = JSON.parse(String(init.body));
        server.tradeSent.push(body);
        return server.trade(body);
      }
      if (server.tcgDown && url.startsWith(`/api/tcg/${server.tcgDown}`))
        return Response.json({ error: 'TCGdex fora do ar' }, { status: 502 });
      const tcg = tcgApi(url);
      if (tcg) return Response.json(tcg.body, { status: tcg.status });
      if (url === '/api/colecao') return server.reply();
      if (url.startsWith('/api/colecao/estoque')) {
        server.stockCalls += 1;
        await server.stockHold;
        return server.stock();
      }
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
    // landing só com nomes: nenhum logo nos cartões das séries
    expect($$('.cx-card img')).toHaveLength(0);
    expect(base.querySelector('.cx-card-name')?.textContent).toBe('Base');
  });

  it('a busca filtra séries e mostra coleções encontradas, sem perder o campo, e avisa quando nada bate', async () => {
    await goHash('#/colecao');
    const input = $<HTMLInputElement>('#colecaoQ');
    const search = (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const total = $$('.cx-card').length;
    search('selva');
    expect($$('.cx-card')).toHaveLength(0);
    expect($('#colecaoBody').textContent).toContain('coleções encontradas');
    expect($$('#colecaoBody .cx-set').map((e) => e.dataset.id)).toEqual(['base2']);
    expect($('#colecaoQ')).toBe(input);
    search('scarlet');
    expect($$('.cx-card').map((e) => e.dataset.id)).toEqual(['sv']);
    search('zzzz');
    expect($('#colecaoBody').textContent).toContain('nada encontrado');
    search('');
    expect($$('.cx-card')).toHaveLength(total);
    expect($('#colecaoBody').textContent).not.toContain('coleções encontradas');
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

describe('coleção interna: página do set', () => {
  afterEach(() => vi.restoreAllMocks());

  const tile = (card: string, variant = '') => $(`.cx-tile[data-key="${card}|${variant}"]`);
  const main = (card: string, variant = '') =>
    tile(card, variant).querySelector<HTMLElement>('.cx-tile-main') as HTMLElement;
  const state = (card: string, variant = '') => tile(card, variant).dataset.state;
  const open = async (set = 'base1', items: unknown[] = [['base1-4', 'holo', 2]]) => {
    server.reply = () => Response.json({ sets: [], items });
    server.sent = [];
    server.putFails = false;
    server.hold = null;
    await goHash('#/colecao');
    await goHash(`#/colset/${set}`);
    await vi.waitFor(() => expect($$('.cx-tile').length).toBeGreaterThan(0));
  };
  const puts = () => server.sent.filter((c) => c.url === '/api/colecao/item').map((c) => c.body);
  const type = (sel: string, value: string) => {
    const el = $<HTMLInputElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const flip = (sel: string, on: boolean) => {
    const el = $<HTMLInputElement>(sel);
    el.checked = on;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const stats = () => $('#cxStats').textContent ?? '';

  it('mostra os números do set, as abas com contagem e o estado de cada carta', async () => {
    await open();
    expect($('#colsetSub').textContent).toContain('Base Set');
    expect(stats()).toContain('09/01/1999');
    expect(stats()).toContain('1/3');
    expect(stats()).toContain('33%');
    expect(stats()).toContain('valor em breve');
    expect($$('#cxTabs .chip').map((c) => c.textContent?.replace(/\s+/g, ' '))).toEqual([
      'todas 3',
      'tenho 1',
      'preciso 2',
      'para trocar 0',
    ]);
    expect([state('base1-2'), state('base1-4'), state('base1-58')]).toEqual(['falta', 'repetida', 'falta']);
    expect(tile('base1-4').querySelector('.cx-qty')?.textContent).toBe('×2');
    expect(tile('base1-2').querySelector('.cx-qty')?.textContent).toBe('+');
    expect($$('#cxHead .cx-crumbs a')).toHaveLength(2);
    expect($('#cxBulk').textContent).toBe('selecionar todas');
  });

  it('tocar marca a variante principal, tocar de novo desmarca, e o servidor recebe cada mudança', async () => {
    await open();
    main('base1-2').click();
    expect(state('base1-2')).toBe('tenho');
    expect(tile('base1-2').querySelector('.cx-qty')?.textContent).toBe('✓');
    expect(stats()).toContain('2/3');
    expect(stats()).toContain('66%');
    await vi.waitFor(() => expect(puts()).toEqual([{ cardId: 'base1-2', variant: 'normal', qty: 1 }]));
    main('base1-2').click();
    expect(state('base1-2')).toBe('falta');
    await vi.waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]).toEqual({ cardId: 'base1-2', variant: 'normal', qty: 0 });
  });

  it('carta que já tem em qualquer variante: tocar tira só as variantes que ela tem', async () => {
    await open();
    main('base1-4').click();
    expect(state('base1-4')).toBe('falta');
    await vi.waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()).toEqual([{ cardId: 'base1-4', variant: 'holo', qty: 0 }]);
  });

  it('se o servidor recusa, a carta volta ao que era e um aviso diz o motivo', async () => {
    await open();
    server.putFails = true;
    main('base1-58').click();
    expect(state('base1-58')).toBe('tenho');
    await vi.waitFor(() => expect(state('base1-58')).toBe('falta'));
    expect($('#toast').textContent).toContain('banco fora do ar');
    expect(stats()).toContain('1/3');
  });

  it('toques seguidos na mesma carta esperam o pedido em andamento e só o último vale', async () => {
    await open();
    let release = () => {};
    server.hold = new Promise<void>((r) => {
      release = r;
    });
    main('base1-2').click();
    main('base1-2').click();
    main('base1-2').click();
    expect(state('base1-2')).toBe('tenho');
    expect(puts()).toHaveLength(1);
    release();
    await settle();
    await settle();
    expect(puts()).toEqual([{ cardId: 'base1-2', variant: 'normal', qty: 1 }]);

    server.hold = new Promise<void>((r) => {
      release = r;
    });
    main('base1-2').click();
    main('base1-2').click();
    expect(state('base1-2')).toBe('tenho');
    release();
    await vi.waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts().map((b) => b.qty)).toEqual([1, 0, 1]);
  });

  it('abas e busca: tenho, preciso, por nome (EN ou PT) e por número; sem resultado, aviso', async () => {
    await open();
    $('[data-action="cx-tab"][data-tab="tenho"]').click();
    expect($$('.cx-tile').map((t) => t.dataset.card)).toEqual(['base1-4']);
    $('[data-action="cx-tab"][data-tab="preciso"]').click();
    expect($$('.cx-tile').map((t) => t.dataset.card)).toEqual(['base1-2', 'base1-58']);
    $('[data-action="cx-tab"][data-tab="todas"]').click();
    type('[data-input="cx-set-q"]', 'blast');
    expect($$('.cx-tile').map((t) => t.dataset.card)).toEqual(['base1-2']);
    type('[data-input="cx-set-q"]', 'charizard pt');
    expect($$('.cx-tile').map((t) => t.dataset.card)).toEqual(['base1-4']);
    type('[data-input="cx-set-q"]', '58');
    expect($$('.cx-tile').map((t) => t.dataset.card)).toEqual(['base1-58']);
    type('[data-input="cx-set-q"]', 'zzz');
    expect($('#cxGrid').textContent).toContain('nada por aqui');
    expect($<HTMLButtonElement>('#cxBulk').disabled).toBe(true);
  });

  it('sem nada marcado, a aba "tenho" avisa; com tudo marcado, "preciso" diz que está completo', async () => {
    await open('base1', []);
    $('[data-action="cx-tab"][data-tab="tenho"]').click();
    expect($('#cxGrid').textContent).toContain('nenhuma carta ainda');
    await open('base1', [
      ['base1-2', 'normal', 1],
      ['base1-4', 'normal', 1],
      ['base1-58', 'normal', 1],
    ]);
    expect(stats()).toContain('completa');
    $('[data-action="cx-tab"][data-tab="preciso"]').click();
    expect($('#cxGrid').textContent).toContain('todas as cartas deste set');
  });

  it('o interruptor de variantes separa cada variante em um quadrado, e marcar vale para a variante tocada', async () => {
    await open();
    flip('[data-input="cx-variants"]', true);
    expect($$('.cx-tile')).toHaveLength(6);
    expect(state('base1-4', 'holo')).toBe('repetida');
    expect(state('base1-4', 'normal')).toBe('falta');
    expect(tile('base1-4', 'holo').textContent).toContain('holo');
    expect(stats()).toContain('1/6');
    main('base1-2', 'holo').click();
    await vi.waitFor(() => expect(puts()).toEqual([{ cardId: 'base1-2', variant: 'holo', qty: 1 }]));
    flip('[data-input="cx-variants"]', false);
    expect($$('.cx-tile')).toHaveLength(3);
  });

  it('selecionar todas pede confirmação, marca só o que falta numa única chamada e vira desmarcar todas', async () => {
    await open();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    $('#cxBulk').click();
    expect(confirm).toHaveBeenCalledWith('Marcar 2 cartas de Base Set?');
    expect(server.sent).toEqual([]);
    expect(state('base1-2')).toBe('falta');

    confirm.mockReturnValue(true);
    $('#cxBulk').click();
    expect(state('base1-2')).toBe('tenho');
    await vi.waitFor(() => expect(server.sent).toHaveLength(1));
    expect(server.sent[0]).toEqual({
      url: '/api/colecao/sets/base1/marcar',
      body: {
        on: true,
        items: [
          ['base1-2', 'normal'],
          ['base1-58', 'normal'],
        ],
      },
    });
    await vi.waitFor(() => expect($('#cxBulk').textContent).toBe('desmarcar todas'));
    await vi.waitFor(() => expect($<HTMLButtonElement>('#cxBulk').disabled).toBe(false));
    expect(stats()).toContain('3/3');

    $('#cxBulk').click();
    expect(confirm).toHaveBeenLastCalledWith('Desmarcar 3 cartas de Base Set?');
    expect($$('.cx-tile').map((t) => t.dataset.state)).toEqual(['falta', 'falta', 'falta']);
    await vi.waitFor(() => expect(server.sent).toHaveLength(2));
    expect(server.sent[1]?.body.on).toBe(false);
    confirm.mockRestore();
  });

  it('se o lote falha, tudo volta ao que era e um aviso diz o motivo', async () => {
    await open();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.putFails = true;
    $('#toast').textContent = '';
    $('#cxBulk').click();
    await vi.waitFor(() => expect($('#toast').textContent).toContain('banco fora do ar'));
    expect($$('.cx-tile').map((t) => t.dataset.state)).toEqual(['falta', 'repetida', 'falta']);
    expect($<HTMLButtonElement>('#cxBulk').disabled).toBe(false);
    confirm.mockRestore();
  });

  it('o selo de quantidade abre o seletor: mais e menos por variante, salvando cada passo', async () => {
    await open();
    tile('base1-4').querySelector<HTMLElement>('.cx-qty')?.click();
    const layer = $('#cxSheet');
    expect(layer.hidden).toBe(false);
    expect($('#cxSheetTitle').textContent).toBe('Charizard');
    const rows = () => $$('.cx-vrow').map((r) => r.querySelector('output')?.textContent);
    expect(rows()).toEqual(['0', '2']);
    expect($$('[data-action="cx-step"][data-d="-1"]').map((b) => (b as HTMLButtonElement).disabled)).toEqual([
      true,
      false,
    ]);
    $('[data-action="cx-step"][data-variant="holo"][data-d="1"]').click();
    expect(rows()).toEqual(['0', '3']);
    expect(tile('base1-4').querySelector('.cx-qty')?.textContent).toBe('×3');
    $('[data-action="cx-step"][data-variant="normal"][data-d="1"]').click();
    await vi.waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()).toEqual([
      { cardId: 'base1-4', variant: 'holo', qty: 3 },
      { cardId: 'base1-4', variant: 'normal', qty: 1 },
    ]);
    $('.cx-backdrop').click();
    expect(layer.hidden).toBe(true);
  });

  it('o seletor fecha com Esc, devolve o foco e não passa de 999 nem desce de 0', async () => {
    await open('base1', [['base1-2', 'normal', 999]]);
    const opener = tile('base1-2').querySelector<HTMLElement>('.cx-qty') as HTMLElement;
    opener.click();
    const plus = $<HTMLButtonElement>('[data-action="cx-step"][data-variant="normal"][data-d="1"]');
    expect(plus.disabled).toBe(true);
    $('[data-action="cx-step"][data-variant="normal"][data-d="-1"]').click();
    expect($('.cx-vrow output').textContent).toBe('998');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('#cxSheet').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.cx-tile[data-key="base1-2|"] .cx-qty'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('set grande mostra 60 por vez, e carta sem imagem nem variantes entra como normal', async () => {
    await open('pop1', []);
    expect($$('.cx-tile')).toHaveLength(60);
    expect($('#cxMore').hidden).toBe(false);
    expect(tile('pop1-1').querySelector('img')).toBeNull();
    expect(stats()).toContain('70');
    $('[data-action="cx-more"]').click();
    expect($$('.cx-tile')).toHaveLength(70);
    expect($('#cxMore').hidden).toBe(true);
    main('pop1-70').click();
    await vi.waitFor(() => expect(puts()).toEqual([{ cardId: 'pop1-70', variant: 'normal', qty: 1 }]));
  });

  it('sair da página do set fecha o seletor aberto', async () => {
    await open();
    tile('base1-4').querySelector<HTMLElement>('.cx-qty')?.click();
    expect($('#cxSheet').hidden).toBe(false);
    await goHash('#/colecao');
    expect($('#cxSheet').hidden).toBe(true);
  });

  describe('aba "para trocar"', () => {
    const STOCK = {
      stock: [
        { id: 'p1', cardId: 'base1-4', lang: 'EN', variant: 'holo', grade: 'PSA 8', price: 5000, available: 1 },
        { id: 'p2', cardId: 'base1-58', lang: 'PT', variant: 'normal', grade: '', price: 12.5, available: null },
      ],
    };
    const trocar = () => $('[data-action="cx-tab"][data-tab="trocar"]').click();
    const rows = () => $$('.cx-trade').map((r) => r.textContent?.replace(/\s+/g, ' ').trim());

    // Primeiro dos testes da folha: o índice e as cartas da enciclopédia ficam guardados depois da primeira busca bem-sucedida.
    it('registrar troca: busca e carta recebida com erro mostram o motivo e não travam a folha', async () => {
      server.stock = () =>
        Response.json({
          stock: [
            ...STOCK.stock,
            { id: 'p3', cardId: 'base1-2', lang: 'PT', variant: 'normal', grade: '', price: null, available: 2 },
          ],
        });
      await open('base1', []);
      trocar();
      await vi.waitFor(() => expect($$('.cx-trade')).toHaveLength(3));
      $('[data-action="cx-trade"][data-id="p1"]').click();
      expect($('#cxTGive').textContent).toContain('sem preço');
      server.tcgDown = 'index';
      type('[data-input="cx-t-q"]', 'pika');
      await vi.waitFor(() => expect($('#cxTFound').textContent).toContain('TCGdex fora do ar'));
      server.tcgDown = 'cards';
      type('[data-input="cx-t-q"]', 'pika');
      await vi.waitFor(() => expect($$('[data-action="cx-t-pick"]').length).toBeGreaterThan(0));
      $('[data-action="cx-t-pick"]').click();
      await vi.waitFor(() => expect($('#toast').textContent).toContain('não deu para abrir a carta'));
      expect($$('#cxTGet .cx-vrow')).toHaveLength(0);
      server.tcgDown = null;
      $('[data-action="cx-close"]').click();
    });

    it('lista o estoque da loja neste set e esconde as ações de marcar', async () => {
      server.stock = () => Response.json(STOCK);
      server.stockCalls = 0;
      await open('base1', [['base1-4', 'holo', 3]]);
      trocar();
      await vi.waitFor(() => expect($$('.cx-trade')).toHaveLength(2));
      expect(rows()).toEqual([
        expect.stringMatching(/Charizard.*holo · EN · PSA 8.*R\$\s?5\.000,00.*−1\+/),
        expect.stringMatching(/Pikachu.*normal · PT.*R\$\s?12,50/),
      ]);
      expect($('.cx-actions').hidden).toBe(true);
      expect($$('#cxTabs .chip').map((c) => c.textContent?.replace(/\s+/g, ' '))).toContain('para trocar 2');
      type('[data-input="cx-set-q"]', 'pika');
      expect($$('.cx-trade')).toHaveLength(1);
      type('[data-input="cx-set-q"]', 'zzz');
      expect($('#cxGrid').textContent).toContain('nada para trocar');
      type('[data-input="cx-set-q"]', '');
      $('[data-action="cx-tab"][data-tab="todas"]').click();
      expect($('.cx-actions').hidden).toBe(false);
      expect($$('.cx-tile')).toHaveLength(3);
      trocar();
      expect($$('.cx-trade')).toHaveLength(2);
      expect(server.stockCalls).toBe(1);
    });

    it('mostra "carregando" enquanto o estoque chega', async () => {
      let release = () => {};
      server.stockHold = new Promise<void>((r) => {
        release = r;
      });
      server.stock = () => Response.json(STOCK);
      await open('base1', [['base1-2', 'normal', 2]]);
      trocar();
      expect($('#cxGrid').textContent).toContain('carregando o estoque da loja');
      expect($$('.cx-trade')).toHaveLength(0);
      release();
      await vi.waitFor(() => expect($$('.cx-trade')).toHaveLength(2));
      expect($('#cxGrid').textContent).not.toContain('carregando');
      server.stockHold = null;
    });

    it('se o estoque falha, o aviso diz o motivo e tentar de novo funciona', async () => {
      server.stock = () => Response.json({ error: 'Notion fora do ar' }, { status: 502 });
      await open('base1', [['base1-4', 'normal', 2]]);
      trocar();
      await vi.waitFor(() =>
        expect($('#cxGrid').textContent).toContain('Estoque da loja indisponível: Notion fora do ar'),
      );
      expect($$('.cx-trade')).toHaveLength(0);
      server.stock = () => Response.json(STOCK);
      $('[data-action="cx-stock-retry"]').click();
      await vi.waitFor(() => expect($$('.cx-trade')).toHaveLength(2));
      expect($('#cxGrid').textContent).not.toContain('indisponível');
    });

    it('o estoque da loja conta como "tenho" sem marcar a coleção; desmarcar volta ao que o estoque cobre', async () => {
      server.stock = () => Response.json(STOCK);
      await open('base1', []);
      await vi.waitFor(() => expect(state('base1-4')).toBe('tenho'));
      expect(state('base1-58')).toBe('tenho'); // sem controle de estoque, a unidade à venda conta como 1
      expect(stats()).toContain('2/3');
      expect(tile('base1-4').querySelector('.cx-qty')?.textContent).toBe('✓');
      server.sent = [];
      main('base1-4').click(); // coleção 0: marca (+1 na coleção), total 2
      await vi.waitFor(() => expect(server.sent).toHaveLength(1));
      expect(server.sent[0]?.body).toMatchObject({ cardId: 'base1-4', qty: 1 });
      expect(state('base1-4')).toBe('repetida');
      main('base1-4').click(); // coleção 1: desmarca, o estoque ainda cobre
      await vi.waitFor(() => expect(server.sent).toHaveLength(2));
      expect(server.sent[1]?.body).toMatchObject({ cardId: 'base1-4', qty: 0 });
      expect(state('base1-4')).toBe('tenho');
      $('[data-action="cx-open"][data-card="base1-4"]').click();
      expect($('.cx-panel').textContent).toContain('+1 na loja');
    });

    it('− e + ajustam o estoque da loja; zerar pede confirmação e o + desfaz', async () => {
      server.stock = () => Response.json(STOCK);
      await open('base1', []);
      trocar();
      await vi.waitFor(() => expect($$('.cx-trade')).toHaveLength(2));
      expect($$('.cx-trade')[1]?.querySelector('[data-action="cx-stock"]')).toBeNull(); // sem controle de estoque
      const step = (d: string) => $(`.cx-trade [data-action="cx-stock"][data-d="${d}"]`);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      server.sent.length = 0;
      step('-1').click();
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('zera o estoque'));
      expect(server.sent).toEqual([]);
      confirm.mockReturnValue(true);
      let hold = () => {};
      server.hold = new Promise<void>((r) => {
        hold = r;
      });
      step('-1').click();
      expect(($('.cx-trade [data-action="cx-stock"]') as HTMLButtonElement).disabled).toBe(true);
      step('-1').click(); // com um ajuste em andamento, o toque é ignorado
      hold();
      server.hold = null;
      await vi.waitFor(() => expect($('.cx-trade output').textContent).toBe('0'));
      expect(server.sent).toEqual([{ url: '/api/colecao/estoque/p1', body: { delta: -1 } }]);
      server.adjust = () => Response.json({ available: 1 });
      step('1').click();
      await vi.waitFor(() => expect($('.cx-trade output').textContent).toBe('1'));
      server.adjust = () => Response.json({ error: 'Não há mais unidades no estoque.' }, { status: 409 });
      confirm.mockClear();
      step('1').click();
      await vi.waitFor(() => expect($('#toast').textContent).toContain('Não há mais unidades'));
      expect($('.cx-trade output').textContent).toBe('1');
      expect(($('.cx-trade [data-action="cx-stock"]') as HTMLButtonElement).disabled).toBe(false);
      confirm.mockRestore();
    });

    it('registrar troca: dou do estoque, recebo mais de uma carta, e a página reflete o resultado', async () => {
      server.stock = () => Response.json(STOCK);
      await open('base1', []);
      trocar();
      await vi.waitFor(() => expect($$('.cx-trade')).toHaveLength(2));
      expect($$('.cx-trade')[1]?.querySelector('[data-action="cx-trade"]')).toBeNull(); // sem controle de estoque
      $('[data-action="cx-trade"][data-id="p1"]').click();
      expect($('#cxSheet').hidden).toBe(false);
      expect(($('#cxTGo') as HTMLButtonElement).disabled).toBe(true); // ainda nada a receber
      expect($('#cxTSum').textContent).toContain('sai 1 un.');
      type('[data-input="cx-t-q"]', 'x');
      expect($('#cxTFound').textContent).toBe('');
      type('[data-input="cx-t-q"]', 'pika');
      await vi.waitFor(() => expect($$('[data-action="cx-t-pick"]').length).toBeGreaterThan(0));
      $('[data-action="cx-t-pick"]').click();
      await vi.waitFor(() => expect($$('#cxTGet .cx-vrow')).toHaveLength(1));
      $('#cxTGet [data-action="cx-t-get"][data-d="1"]').click();
      expect($('#cxTSum').textContent).toContain('entra 2 un.');
      $('[data-action="cx-t-pick"]');
      type('[data-input="cx-t-q"]', 'pika');
      await vi.waitFor(() => expect($$('[data-action="cx-t-pick"]').length).toBeGreaterThan(0));
      $('[data-action="cx-t-pick"]').click(); // a mesma carta e variante soma
      await vi.waitFor(() => expect($('#cxTSum').textContent).toContain('entra 3 un.'));
      expect($$('#cxTGet .cx-vrow')).toHaveLength(1);
      const sel = $('#cxTGet select') as HTMLSelectElement;
      sel.value = sel.options[sel.options.length - 1]?.value ?? '';
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      server.trade = () =>
        Response.json({
          gave: [{ id: 'p1', available: 0 }],
          got: [{ cardId: 'base1-58', variant: sel.value, qty: 3 }],
        });
      $('[data-action="cx-t-give"][data-d="-1"]').click(); // tirar a única unidade desliga o botão
      expect(($('#cxTGo') as HTMLButtonElement).disabled).toBe(true);
      $('[data-action="cx-t-give"][data-d="1"]').click();
      $('#cxTGo').click();
      await vi.waitFor(() => expect($('#cxSheet').hidden).toBe(true));
      expect(server.tradeSent.at(-1)).toEqual({
        give: [{ id: 'p1', qty: 1 }],
        get: [{ cardId: 'base1-58', variant: sel.value, qty: 3 }],
      });
      expect($('#toast').textContent).toContain('troca registrada');
      expect($('.cx-trade output').textContent).toBe('0');
    });

    it('registrar troca: se o servidor recusa, a folha fica aberta com o motivo e dá para tentar de novo', async () => {
      server.stock = () => Response.json(STOCK);
      await open('base1', []);
      trocar();
      await vi.waitFor(() => expect($$('.cx-trade')).toHaveLength(2));
      $('[data-action="cx-trade"][data-id="p1"]').click();
      type('[data-input="cx-t-q"]', 'pika');
      await vi.waitFor(() => expect($$('[data-action="cx-t-pick"]').length).toBeGreaterThan(0));
      $('[data-action="cx-t-pick"]').click();
      await vi.waitFor(() => expect($$('#cxTGet .cx-vrow')).toHaveLength(1));
      $('#cxTGet [data-action="cx-t-get"][data-d="-1"]').click(); // zera e tira a carta
      expect($$('#cxTGet .cx-vrow')).toHaveLength(0);
      type('[data-input="cx-t-q"]', 'zzzz');
      await vi.waitFor(() => expect($('#cxTFound').textContent).toContain('Nenhuma carta'));
      type('[data-input="cx-t-q"]', 'pika');
      await vi.waitFor(() => expect($$('[data-action="cx-t-pick"]').length).toBeGreaterThan(0));
      $('[data-action="cx-t-pick"]').click();
      await vi.waitFor(() => expect($$('#cxTGet .cx-vrow')).toHaveLength(1));
      server.trade = () => Response.json({ error: 'O estoque mudou' }, { status: 409 });
      $('#cxTGo').click();
      await vi.waitFor(() => expect($('#cxTErr').textContent).toContain('O estoque mudou'));
      expect($('#cxSheet').hidden).toBe(false);
      expect(($('#cxTGo') as HTMLButtonElement).disabled).toBe(false);
      $('[data-action="cx-close"]').click();
      expect($('#cxSheet').hidden).toBe(true);
    });

    it('sem estoque, avisa que não há nada para trocar', async () => {
      server.stock = () => Response.json({ stock: [] });
      await open('base1', [['base1-2', 'normal', 1]]);
      trocar();
      await vi.waitFor(() => expect($('#cxGrid').textContent).toContain('nada para trocar'));
      expect($$('.cx-trade')).toHaveLength(0);
    });
  });
});
