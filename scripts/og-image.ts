/**
 * Gera public/og.png (1200×630, prévia de link no WhatsApp/Instagram) e public/apple-touch-icon.png (180×180)
 * a partir das cores e fontes do próprio site. Uso: node --experimental-strip-types scripts/og-image.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const cube = readFileSync('public/favicon.svg', 'utf-8');
const fonts =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@800;900&family=IBM+Plex+Mono:wght@500&display=block">';

const og = `<!doctype html><html><head>${fonts}<style>
  body{margin:0;width:1200px;height:630px;background:#101419;color:#EDEFF2;font-family:Archivo,sans-serif;
    display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box;position:relative;overflow:hidden}
  .brand{display:flex;align-items:center;gap:18px;font:900 44px/1 Archivo;letter-spacing:-.04em}
  .brand svg{width:64px;height:64px}
  h1{font:900 132px/.9 Archivo;letter-spacing:-.05em;margin:40px 0 30px}
  .dot{color:#F42744}
  p{font:500 22px/1.3 "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:#3ED9F0;margin:0}
  .big{position:absolute;right:56px;top:150px;width:320px;height:320px}
</style></head><body><div class="brand">${cube}<span>cubodex</span></div>
  <h1>colecione<span class="dot">.</span><br>crie<span class="dot">.</span></h1>
  <p>cartas de pokémon · miniaturas · impressão 3D</p><div class="big">${cube}</div></body></html>`;

const icon = `<!doctype html><html><body style="margin:0;width:180px;height:180px;background:#101419;display:grid;place-items:center">
  <div style="width:120px;height:120px">${cube}</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(og, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'public/og.png' });
await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(icon);
await page.screenshot({ path: 'public/apple-touch-icon.png' });
await browser.close();
console.log('public/og.png e public/apple-touch-icon.png gerados');
