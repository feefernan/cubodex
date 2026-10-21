import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, lookupCep } from '../../src/infra/api';
import { loadState, loadTheme, saveState, saveTheme } from '../../src/infra/storage';

afterEach(() => vi.unstubAllGlobals());

describe('armazenamento no navegador', () => {
  it('sem localStorage (aba privada, bloqueado) o site segue sem salvar', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
    });
    expect(loadState()).toBeNull();
    expect(loadTheme()).toBeNull();
    expect(() => saveTheme('1a')).not.toThrow();
    expect(() => saveState({ user: null, cart: [], dex: {}, vault: [], hist: [], pendingSerial: '' })).not.toThrow();
  });
  it('JSON corrompido é ignorado', () => {
    const store: Record<string, string> = { 'cubodex-proto-v1': '{quebrado' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => (store[k] = v),
    });
    expect(loadState()).toBeNull();
    saveTheme('1b');
    expect(loadTheme()).toBe('1b');
  });
});

describe('cliente da API', () => {
  it('sem rede: mensagem de conexão; erro sem corpo: mensagem genérica', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(api.catalog()).rejects.toThrow('Sem conexão');
    vi.stubGlobal('fetch', async () => new Response('html de erro', { status: 500 }));
    await expect(api.status('CBX-20261016-AAAAAA')).rejects.toThrow('Algo deu errado');
  });
  it('ViaCEP: CEP inexistente ou fora do ar devolve null', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ erro: true }));
    expect(await lookupCep('00000000')).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    expect(await lookupCep('01310100')).toBeNull();
    vi.stubGlobal('fetch', async () => Response.json({ localidade: 'Rio de Janeiro', uf: 'RJ' }));
    expect(await lookupCep('20040020')).toEqual({ street: '', district: '', city: 'Rio de Janeiro', uf: 'RJ' });
  });
});
