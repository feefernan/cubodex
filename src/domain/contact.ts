/** Contato e encomenda pelo WhatsApp (#18). */

// shortcut: número do WhatsApp da Cubodex ainda não definido (#18); só dígitos com DDI, ex.: '5511900000000'.
const WHATSAPP = '';

export interface QuoteRequest {
  name: string;
  description: string;
  size: string;
  material: string;
}

/** Mensagem pré-preenchida do pedido de orçamento. */
export const quoteRequestText = (q: QuoteRequest): string =>
  [
    'Olá, Cubodex! Quero um orçamento de peça sob medida.',
    q.name.trim() && `Nome: ${q.name.trim()}`,
    `O que preciso: ${q.description.trim()}`,
    q.size.trim() && `Medidas: ${q.size.trim()} mm`,
    q.material && `Material: ${q.material}`,
  ]
    .filter(Boolean)
    .join('\n');

/** Link wa.me com a mensagem; null enquanto o número não existe. */
export const whatsappUrl = (text: string, phone = WHATSAPP): string | null =>
  /^\d{12,13}$/.test(phone) ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null;
