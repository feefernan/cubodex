import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf-8');
const meta = (attr: string, name: string) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`))?.[1];

describe('SEO e prévia de link (#12)', () => {
  it('título, descrição e endereço canônico no domínio', () => {
    expect(html).toContain('<title>Cubodex · cartas de pokémon, produtos selados e impressão 3D</title>');
    expect(meta('name', 'description')?.length).toBeGreaterThan(80);
    expect(html).toContain('<link rel="canonical" href="https://acubodex.com.br/">');
  });

  it('Open Graph completo com imagem de 1200×630 que existe', () => {
    for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'og:locale'])
      expect(meta('property', p), p).toBeTruthy();
    expect(meta('property', 'og:image')).toBe('https://acubodex.com.br/og.png');
    const png = readFileSync(resolve(root, 'public/og.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(existsSync(resolve(root, 'public/apple-touch-icon.png'))).toBe(true);
  });

  it('dados estruturados válidos e robots/sitemap apontando para o domínio', () => {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1] ?? '{}');
    expect(ld).toMatchObject({ '@type': 'Store', name: 'Cubodex', url: 'https://acubodex.com.br/' });
    const robots = readFileSync(resolve(root, 'public/robots.txt'), 'utf-8');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Sitemap: https://acubodex.com.br/sitemap.xml');
    expect(readFileSync(resolve(root, 'public/sitemap.xml'), 'utf-8')).toContain('<loc>https://acubodex.com.br/</loc>');
  });
});
