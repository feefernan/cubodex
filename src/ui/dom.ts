export const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Elemento ${selector} não encontrado`);
  return el;
};

export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(selector));

type Handler<E extends Event = Event> = (el: HTMLElement, event: E) => void;

const clicks = new Map<string, Handler>();
const inputs = new Map<string, Handler>();
const submits = new Map<string, Handler<SubmitEvent>>();

/** `data-action="nome"` no HTML → `onAction('nome', handler)` no módulo da área. */
export const onAction = (name: string, handler: Handler) => clicks.set(name, handler);
/** `data-input="nome"` em campos → chamado a cada digitação/mudança. */
export const onInput = (name: string, handler: Handler) => inputs.set(name, handler);
/** Envio do formulário com esse `id` (o envio nativo é sempre cancelado). */
export const onSubmit = (formId: string, handler: Handler<SubmitEvent>) => submits.set(formId, handler);

export const bindEvents = (root: Document = document) => {
  root.addEventListener('click', (event) => {
    const el = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const handler = clicks.get(el.dataset.action as string);
    if (!handler) return;
    if (el.tagName === 'A') event.preventDefault();
    handler(el, event);
  });
  root.addEventListener('input', (event) => {
    const el = event.target as HTMLElement;
    const name = el.dataset?.input;
    if (name) inputs.get(name)?.(el, event);
  });
  root.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    event.preventDefault();
    submits.get(form.id)?.(form, event);
  });
};

/** Atributo de botão desabilitado; a aparência vem do CSS (`:disabled`). */
export const disabledAttr = (on: boolean) => (on ? ' disabled' : '');

/**
 * Valida um campo: com erro, mostra `html` na mensagem e marca o campo para leitores de tela
 * (`aria-invalid` + `aria-describedby`, foco no campo); sem erro, limpa a marca (#11).
 */
export const check = (input: HTMLElement, msgEl: HTMLElement, ok: boolean, html: string): boolean => {
  if (ok) {
    input.removeAttribute('aria-invalid');
    return true;
  }
  msgEl.innerHTML = html;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', msgEl.id);
  input.focus();
  return false;
};
