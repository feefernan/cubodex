export const isEmail = (s: string): boolean => /^\S+@\S+\.\S+$/.test(s);

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
