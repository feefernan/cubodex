import { escapeHtml as esc } from '../domain/format';
import { SERIAL_PATTERN } from '../domain/order';
import { api } from '../infra/api';
import { alertMsg, clearCart, progress } from './cart';
import { $, onAction } from './dom';
import { currentView, registerView } from './router';
import { persist, S } from './store';

const STATUS_TEXT: Record<string, string> = {
  Pago: '<b>Pagamento confirmado.</b> Obrigado! As cartas do cofre já estão nele e o resto segue para o envio.',
  'Aguardando pagamento':
    'Aguardando a confirmação do Mercado Pago. Pix costuma confirmar em segundos; boleto, em até 3 dias úteis.',
  Novo: '<b>Pedido registrado.</b> A Cubodex entra em contato pelo e-mail informado para combinar o pagamento.',
  Cancelado: 'O pagamento não foi aprovado. Seu carrinho continua aqui para tentar de novo.',
};

const box = (inner: string) =>
  `<div class="card" style="margin-top:24px;max-width:60ch"><p class="mono muted">pedido ${esc(S.orderSerial)}</p>${inner}</div>`;

const LINKS =
  '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--ghost btn--sm" data-action="order-refresh">atualizar status</button><a class="btn btn--sm" href="#/colecionar" data-action="go" data-view="colecionar">continuar comprando</a></div>';
const BACK_TO_CART =
  '<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn--sm" href="#/carrinho" data-action="go" data-view="carrinho">voltar ao carrinho</a></div>';

/** Consulta de novo a cada 5 s por até 2 min enquanto o Pix ou o boleto não confirma. */
const POLL_MS = 5000;
const POLL_MAX = 24;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Mostra o status do pedido na volta do Mercado Pago. Só o pedido que saiu daqui para o pagamento
 * (`pendingSerial`) esvazia o carrinho: abrir o link de um pedido antigo não apaga o carrinho de agora.
 */
const renderOrder = async (attempt = 0) => {
  clearTimeout(timer);
  const body = $('#pedidoBody');
  const serial = S.orderSerial;
  if (!SERIAL_PATTERN.test(serial)) {
    body.innerHTML = box('<p class="soft">Pedido não encontrado. Confira o link.</p>');
    return;
  }
  if (!attempt) body.innerHTML = box(progress('consultando o pedido…'));
  try {
    const status = await api.status(serial);
    if (currentView() !== 'pedido' || S.orderSerial !== serial) return;
    if (status === 'Pago' && S.pendingSerial === serial) {
      clearCart();
      S.pendingSerial = '';
      persist();
    }
    if (status === 'Cancelado' && S.pendingSerial === serial) {
      S.pendingSerial = '';
      persist();
    }
    const links = status === 'Cancelado' ? BACK_TO_CART : LINKS;
    body.innerHTML = box(`<p>${STATUS_TEXT[status] ?? esc(status)}</p>${links}`);
    if (status === 'Aguardando pagamento' && attempt < POLL_MAX)
      timer = setTimeout(() => void renderOrder(attempt + 1), POLL_MS);
  } catch (e) {
    body.innerHTML = box(`${alertMsg((e as Error).message)}${LINKS}`);
  }
};

export const initOrder = () => {
  registerView('pedido', () => void renderOrder());
  onAction('order-refresh', () => void renderOrder());
};
