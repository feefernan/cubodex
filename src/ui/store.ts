import { initialState, mergePersisted } from '../domain/state';
import { loadState, saveState } from '../infra/storage';

/** Estado da aplicação (uma instância por aba). */
export const S = mergePersisted(initialState(), loadState());

export const persist = () => saveState(S);
