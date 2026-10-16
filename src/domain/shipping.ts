export interface ShippingOption {
  name: string;
  days: string;
  price: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

// shortcut: frete inventado a partir do 1º dígito do CEP, até o Melhor Envio entrar (#21).
const simulate = (cep: string, base: [number, number], perUnit: number, units: number): ShippingOption[] => {
  const d = Number.parseInt(cep.charAt(0), 10) || 0;
  return [
    { name: 'econômico', days: '6 a 9 dias úteis', price: cents(base[0] + d * 1.1 + units * perUnit) },
    { name: 'expresso', days: '2 a 4 dias úteis', price: cents(base[1] + d * 1.6 + units * perUnit) },
  ];
};

export const quoteCart = (cep: string) => simulate(cep, [14.9, 27.5], 0, 0);
export const quoteVault = (cep: string, units: number) => simulate(cep, [12.9, 25.5], 1.5, units);
