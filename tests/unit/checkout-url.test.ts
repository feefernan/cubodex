import { describe, expect, it } from 'vitest';
import { isCheckoutUrl } from '../../src/ui/cart';

describe('link do checkout', () => {
  it('aceita só https do Mercado Pago', () => {
    expect(isCheckoutUrl('https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1')).toBe(true);
    expect(isCheckoutUrl('https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=1')).toBe(true);
    expect(isCheckoutUrl('http://www.mercadopago.com.br/x')).toBe(false);
    expect(isCheckoutUrl('https://mercadopago.com.br.evil.test/x')).toBe(false);
    expect(isCheckoutUrl('https://evil.test/mercadopago.com.br')).toBe(false);
    expect(isCheckoutUrl('javascript:alert(1)')).toBe(false);
    expect(isCheckoutUrl('não é url')).toBe(false);
  });
});
