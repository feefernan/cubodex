import './styles/main.css';
import './styles/motion.css';
import { applyStock, parseStockRows } from './domain/stock';
import { api } from './infra/api';
import { initAccount } from './ui/account';
import { initCart, updateBadge } from './ui/cart';
import { initCollectibles } from './ui/collectibles';
import { bindEvents } from './ui/dom';
import { initOrder } from './ui/order';
import { initPages } from './ui/pages';
import { initRouter, refresh } from './ui/router';
import { syncSession } from './ui/session';
import { initTcg } from './ui/tcg';
import { initTheme } from './ui/theme';
import { initVault } from './ui/vault';

bindEvents();
initCart();
initTcg();
initVault();
initCollectibles();
initAccount();
initPages();
initOrder();
initTheme();
initRouter();

// Preço e estoque atuais vêm do Notion pela API; sem ela, o site segue com o catálogo do código.
api
  .catalog()
  .then((data) => {
    const rows = parseStockRows(data);
    if (!rows.length) return;
    applyStock(rows);
    updateBadge();
    refresh();
  })
  .catch((e) => console.warn('catálogo da API indisponível', e));

// Conta: com sessão, Dex, cofre e pedidos vêm do servidor.
void syncSession();
