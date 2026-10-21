import { describe, expect, it } from 'vitest';
import { plan } from '../../src/ui/art';

describe('desenho técnico da peça', () => {
  it('desenha a planta em escala com as três medidas', () => {
    const svg = plan('90 × 60 × 28 mm');
    expect(svg).toContain('>90 mm<');
    expect(svg).toContain('>60 mm<');
    expect(svg).toContain('>altura 28 mm<');
    // 90 × 60 em 150 × 96: a profundidade limita (96/60 = 1,6), então a planta fica 144 × 96, centrada.
    expect(svg).toContain('<rect x="39" y="34" width="144" height="96"/>');
  });

  it('aceita vírgula decimal, sem altura e sem medidas', () => {
    expect(plan('12,5 × 10 mm')).toContain('>12.5 mm<');
    expect(plan('12,5 × 10 mm')).not.toContain('altura');
    expect(plan('')).toContain('>1 mm<');
  });
});
