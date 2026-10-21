import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_UPDATED, STORE, WITHDRAWAL_DAYS } from '../../src/domain/legal';
import { APOIO } from '../../src/ui/apoio';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const footer = html.slice(html.indexOf('<footer>'), html.indexOf('</footer>'));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** Dígitos verificadores do CNPJ (módulo 11, pesos de Receita Federal). */
const cnpjOk = (c: string) => {
  const d = c.replace(/\D/g, '').split('').map(Number);
  const dv = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = d.slice(0, n).reduce((a, x, i) => a + x * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return d.length === 14 && dv(12) === d[12] && dv(13) === d[13];
};

describe('identidade da loja (Decreto 7.962)', () => {
  it('o CNPJ tem dígitos verificadores válidos e a razão social começa pela raiz dele', () => {
    expect(cnpjOk(STORE.cnpj)).toBe(true);
    expect(STORE.legalName.startsWith(STORE.cnpj.slice(0, 10))).toBe(true);
  });
  it('o rodapé estático traz razão social, CNPJ, endereço e e-mail, iguais ao módulo', () => {
    const t = text(footer);
    for (const v of [STORE.legalName, STORE.cnpj, STORE.address, STORE.email]) expect(t).toContain(v);
    expect(footer).toContain(`href="mailto:${STORE.email}"`);
    // O endereço fica sem complemento (decisão do dono, casa).
    expect(STORE.address).not.toMatch(/apto|ap\.|bloco|casa/i);
  });
  it('o rodapé leva a todas as páginas legais, e todas existem', () => {
    for (const tab of ['termos', 'privacidade', 'trocas', 'contato']) {
      expect(footer).toContain(`data-tab="${tab}"`);
      expect(APOIO[tab]).toBeDefined();
    }
    expect(footer).toContain('TCGdex');
  });
});

describe('textos da ajuda', () => {
  it('não sobrou aviso de "em revisão" nem placeholder', () => {
    for (const [tab, body] of Object.entries(APOIO)) {
      expect(body, tab).not.toMatch(/em revisão|será publicad|a definir|lorem|\[.*\]/i);
    }
  });
  it('trocas: arrependimento de 7 dias com reembolso do frete, defeito, sob medida e cofre', () => {
    const t = text(APOIO.trocas);
    expect(WITHDRAWAL_DAYS).toBe(7);
    expect(t).toContain('7 dias corridos');
    expect(t).toContain('inclusive o frete');
    expect(t).toMatch(/90 dias/);
    expect(t).toContain('sob medida');
    expect(t).toContain('cofre');
    expect(t).toContain(LEGAL_UPDATED);
  });
  it('privacidade: dados, bases e direitos da LGPD, e o que sai do navegador para terceiros', () => {
    const t = text(APOIO.privacidade);
    for (const w of [
      'CPF',
      'Mercado Pago',
      'Melhor Envio',
      'Cloudflare',
      'Notion',
      'Google',
      'TCGdex',
      '5 anos',
      'cookie',
    ])
      expect(t, w).toContain(w);
    expect(t).toContain(STORE.email);
    expect(t).toMatch(/acesso, correção e exclusão/);
  });
  it('termos e como comprar citam a nota fiscal, o cofre e as marcas', () => {
    expect(text(APOIO.termos)).toContain('não é afiliada à The Pokémon Company');
    expect(text(APOIO.termos)).toContain('cobrado à parte');
    expect(text(APOIO.comprar)).toContain('nota fiscal em todas as compras');
    expect(text(APOIO.faq)).toContain('Vocês emitem nota fiscal?');
  });
});
