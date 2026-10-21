export const isEmail = (s: string): boolean => /^\S+@\S+\.\S+$/.test(s);

/** CPF válido (11 dígitos, dígitos verificadores e não todos iguais): o Melhor Envio recusa a etiqueta sem ele. */
export const isCpf = (s: string): boolean => {
  const d = s.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    const sum = [...d.slice(0, n)].reduce((acc, c, i) => acc + Number(c) * (n + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
};

/** "11999998888" → "(11) 99999-8888"; vale celular (11 dígitos) e fixo (10). */
export const formatPhone = (s: string): string => {
  const d = s.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  const split = d.length > 10 ? 7 : 6;
  return d.length <= 6
    ? `(${d.slice(0, 2)}) ${d.slice(2)}`
    : `(${d.slice(0, 2)}) ${d.slice(2, split)}-${d.slice(split)}`;
};

export const isPhone = (s: string): boolean => /^\d{2}9?\d{8}$/.test(s.replace(/\D/g, ''));

/** "123.456.789-09" enquanto digita. */
export const formatCpf = (s: string): string => {
  const d = s.replace(/\D/g, '').slice(0, 11);
  return (
    [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join('.') + (d.length > 9 ? `-${d.slice(9)}` : '')
  );
};

/** Só os dígitos do CEP, no máximo 8. */
export const cepDigits = (s: string): string => s.replace(/\D/g, '').slice(0, 8);

/** "01000000" → "01000-000" (enquanto digita, só põe o hífen depois do 5º dígito). */
export const formatCep = (s: string): string => {
  const d = cepDigits(s);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/** "3d 04h 05m 06s" até a data; "já saiu" depois dela. */
export const countdown = (target: string, now: number): string => {
  const t = new Date(target).getTime() - now;
  if (Number.isNaN(t) || t <= 0) return 'já saiu';
  const two = (n: number) => String(n).padStart(2, '0');
  const d = Math.floor(t / 864e5);
  const h = Math.floor((t % 864e5) / 36e5);
  const m = Math.floor((t % 36e5) / 6e4);
  const s = Math.floor((t % 6e4) / 1e3);
  return `${d}d ${two(h)}h ${two(m)}m ${two(s)}s`;
};
