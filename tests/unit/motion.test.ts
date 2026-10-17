import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (f: string) => readFileSync(resolve(__dirname, '../../src/styles', f), 'utf-8');
const motion = css('motion.css');
const all = motion + css('main.css');

describe('sistema de motion (#13)', () => {
  it('entrada de tela com fill backwards: nada de transform/filter residual quebrando position: fixed', () => {
    expect(motion).toMatch(/\.view:not\(\[hidden\]\)\s*\{\s*animation: enter [^;]* backwards;/);
    expect(motion).not.toMatch(/animation:[^;]*\b(both|forwards)\b/);
  });

  it('nunca ease/ease-in-out puros e só transform, opacity e filter nas animações', () => {
    expect(all).not.toMatch(/(transition|animation)[^;{}]*\b(ease|ease-in-out|ease-in)\b(?!-)/);
    const keyframes = motion.match(/@keyframes [\w-]+\s*\{[\s\S]*?\n\}/g) ?? [];
    for (const k of keyframes)
      for (const prop of k.match(/^\s+([a-z-]+):/gm) ?? [])
        expect(['opacity', 'transform', 'filter']).toContain(prop.trim().replace(':', ''));
  });

  it('movimento reduzido desliga animações, transições e rolagem suave', () => {
    const reduced = motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const rule of ['animation-duration: 0.01ms', 'transition-duration: 0.01ms', 'scroll-behavior: auto'])
      expect(reduced).toContain(rule);
  });

  it('hover que move só em aparelhos com mouse (no toque o hover gruda)', () => {
    expect(motion).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.door:hover/);
  });
});
