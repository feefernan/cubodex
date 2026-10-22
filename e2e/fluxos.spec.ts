import { expect, test } from '@playwright/test';
import { tcgApi } from '../tests/fixtures/tcg';

// API da loja e ViaCEP simulados: respondem como os reais (o Worker local não tem tokens).
test.beforeEach(async ({ page }) => {
  await page.route('**/api/catalog', (route) => route.fulfill({ json: { products: [] } }));
  await page.route('**/api/me', (route) => route.fulfill({ status: 401, json: { error: 'Entre na sua conta.' } }));
  await page.route('**/api/shipping/quote', (route) =>
    route.fulfill({
      json: {
        options: [
          { id: 1, name: 'PAC', company: 'Correios', price: 22.5, days: 7 },
          { id: 2, name: 'SEDEX', company: 'Correios', price: 38.9, days: 3 },
        ],
      },
    }),
  );
  await page.route('**/api/orders', (route) =>
    route.fulfill({ status: 201, json: { serial: 'CBX-20261016-E2E2E2', total: 158.9, checkoutUrl: null } }),
  );
  await page.route('**/api/orders/*/status', (route) => route.fulfill({ json: { status: 'Novo' } }));
  await page.route('https://viacep.com.br/**', (route) =>
    route.fulfill({
      json: { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' },
    }),
  );
});

test.describe('fluxos principais', () => {
  test('home carrega sem erros de console', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('colecione');
    await expect(page.locator('#hl-tcg .tile')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('compra de carta: filtro, carrinho, frete, checkout e pedido', async ({ page }) => {
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
    await page.locator('[data-action="ship"]').nth(1).click();
    await page.locator('[data-action="checkout-open"]').click();
    await expect(page.locator('#ck-street')).toHaveValue('Avenida Paulista');
    await page.locator('#ck-name').fill('Ana Lima');
    await page.locator('#ck-email').fill('ana@exemplo.com');
    await page.locator('#ck-cpf').fill('52998224725');
    await page.locator('#ck-phone').fill('11999998888');
    await page.locator('#ck-number').fill('1000');
    await page.locator('#formCheckout button[type="submit"]').click();
    await expect(page).toHaveURL(/#\/pedido\/CBX-20261016-E2E2E2$/);
    await expect(page.locator('#pedidoBody')).toContainText('Pedido registrado');
  });

  test('pacote de miniaturas e dex', async ({ page }) => {
    await page.goto('/#serie');
    for (const id of ['m1', 'm2', 'm3']) await page.locator(`[data-action="pack-add"][data-id="${id}"]`).click();
    await page.locator('[data-action="pack-buy"]').click();
    await expect(page.locator('#cartCount')).toHaveText('1');
    await page.locator('#v-serie .colnav [data-view="dex"]').click();
    // Visitante novo começa deslogado; a demo traz a Dex de exemplo.
    await page.locator('#dexBody [data-action="login-demo"]').click();
    await page.locator('[data-action="dex"][data-id="m3"][data-st="have"]').click();
    await expect(page.locator('#dexBody .dex-count')).toContainText('6');
  });

  test('link compartilhado abre a carta e o voltar do navegador volta de tela', async ({ page }) => {
    await page.route('**/api/tcg/**', (route) => {
      const r = tcgApi(new URL(route.request().url()).pathname);
      return route.fulfill({ status: r?.status ?? 404, json: r?.body ?? {} });
    });
    await page.goto('/#/carta/base1-4');
    await expect(page.locator('#cartaBody h1')).toHaveText('Charizard');
    await page.locator('#cartaBody a.link-more').click();
    await expect(page).toHaveURL(/#\/set\/base1$/);
    await expect(page.locator('#setBody h1')).toContainText('Base Set');
    await page.goBack();
    await expect(page.locator('#cartaBody h1')).toHaveText('Charizard');
    await page.goForward();
    await expect(page.locator('#setBody h1')).toContainText('Base Set');
  });

  test('entrar: o botão leva ao login do Google', async ({ page }) => {
    await page.route('**/api/auth/google', (route) =>
      route.fulfill({ status: 303, headers: { Location: '/#/conta/erro-login' } }),
    );
    await page.goto('/#/conta');
    await page.getByRole('link', { name: 'entrar com Google' }).click();
    await expect(page.locator('#lg-msg')).toContainText('Não deu para entrar com o Google');
  });

  test('carrinho e dex sobrevivem a recarregar a página', async ({ page }) => {
    await page.goto('/#acessorios');
    await page.locator('#accGrid [data-action="add"]').first().click();
    await page.reload();
    await expect(page.locator('#cartCount')).toHaveText('1');
  });
});
