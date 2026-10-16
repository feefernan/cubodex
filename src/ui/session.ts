import type { Dex } from '../domain/collection';
import { type Account, ApiError, api } from '../infra/api';
import { refresh } from './router';
import { persist, S } from './store';
import { toast } from './toast';

/** Conta real (não a demonstração): Dex, cofre e pedidos vivem no servidor. */
export const isRealUser = () => !!S.user && !S.user.demo;

const applyAccount = (acc: Account) => {
  S.user = { name: acc.user.name, email: acc.user.email };
  S.dex = acc.dex;
  S.vault = acc.vault;
  S.hist = acc.hist;
  S.orders = acc.orders;
  persist();
};

/**
 * Ao abrir o site: se há sessão, a conta vem do servidor; a Dex marcada antes de entrar (neste aparelho) vai
 * para a conta se ela ainda estiver vazia. Sem sessão, um usuário real salvo no navegador sai (sessão expirou).
 */
export const syncSession = async () => {
  const localDex: Dex = S.user?.demo ? {} : { ...S.dex };
  try {
    const acc = await api.me();
    applyAccount(acc);
    if (!Object.keys(acc.dex).length && Object.keys(localDex).length) {
      S.dex = (await api.saveDex(localDex)).dex;
      persist();
    }
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !isRealUser()) return;
    Object.assign(S, { user: null, dex: {}, vault: [], hist: [], orders: [] });
    persist();
  }
  refresh();
};

/** Dex mudou: na conta real, salva no servidor (a tela já mostrou a mudança). */
export const pushDex = () => {
  if (!isRealUser()) return;
  api.saveDex(S.dex).catch(() => toast('não deu para salvar a dex agora; tente de novo'));
};
