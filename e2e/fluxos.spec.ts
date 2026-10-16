import { expect, test } from '@playwright/test';

test.describe('fluxos principais', () => {
  test('home carrega sem erros de console', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('colecione');
    await expect(page.locator('#hl-tcg .tile')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('compra de carta: filtro, carrinho, frete e pagamento simulado', async ({ page }) => {
    await page.goto('/#tcg');
    // No celular os filtros começam recolhidos.
    if (!(await page.locator('#f-lang').isVisible())) await page.locator('#filtersBox summary').click();
    await page.locator('#f-lang').selectOption('PT');
    await expect(page.locator('#tcgCount')).toHaveText('3 itens');
    await page.locator('#tcgGrid [data-action="add"]').first().click();
    await expect(page.locator('#cartCount')).toHaveText('1');
    await page.locator('.head-actions [data-view="carrinho"]').click();
    await page.locator('#cep').fill('01310100');
    await page.locator('#formFrete button[type="submit"]').click();
    await page.locator('[data-action="ship"]').first().click();
    await page.locator('[data-action="pay"]').click();
    await expect(page.locator('#cartBody .msg')).toContainText('Fase 2');
  });

  test('pacote de miniaturas e dex', async ({ page }) => {
    await page.goto('/#serie');
    for (const id of ['m1', 'm2', 'm3']) await page.locator(`[data-action="pack-add"][data-id="${id}"]`).click();
    await page.locator('[data-action="pack-buy"]').click();
    await expect(page.locator('#cartCount')).toHaveText('1');
    await page.locator('#v-serie .colnav [data-view="dex"]').click();
    await page.locator('[data-action="dex"][data-id="m3"][data-st="have"]').click();
    await expect(page.locator('#dexBody .dex-count')).toContainText('6');
  });

  test('carrinho e dex sobrevivem a recarregar a página', async ({ page }) => {
    await page.goto('/#acessorios');
    await page.locator('#accGrid [data-action="add"]').first().click();
    await page.reload();
    await expect(page.locator('#cartCount')).toHaveText('1');
  });
});
