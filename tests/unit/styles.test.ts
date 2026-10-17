import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/styles/main.css'), 'utf-8');

describe('estilos', () => {
  it('opção de frete escolhida tem borda da cor do texto, visível em qualquer tema (#6)', () => {
    expect(css).toMatch(/\.ship-opt\[aria-pressed="true"\]\{border-color:var\(--fg\)/);
  });
  it('vermelho de ação com contraste AA para texto branco (#10)', () => {
    expect(css).toContain('--action:#D21F3C');
    expect(css).not.toMatch(/data-tema="1[a-d]"/);
  });
  it('só dois temas: escuro (padrão) e claro (#14)', () => {
    expect(css.match(/data-tema="(\w+)"/g)?.every((t) => t === 'data-tema="claro"')).toBe(true);
    expect(css).not.toContain('.themer');
    expect(css).not.toContain('.proto-bar');
  });
  it('botão desabilitado é estilizado pelo CSS, não por style inline (#11)', () => {
    expect(css).toContain('.btn:disabled{');
  });
});
