import type { Db } from './accounts';
import type { Mailer } from './email';

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  SITE_URL: string;
  CONTACT_EMAIL: string;
  NOTION_PRODUCTS_DB: string;
  NOTION_ORDERS_DB: string;
  NOTION_SUBSCRIBERS_DB: string;
  MELHOR_ENVIO_API: string;
  /** CEP de onde as peças saem; vazio = frete desligado. */
  ORIGIN_CEP: string;
  ORDERS_LIMITER: Limiter;
  QUOTES_LIMITER: Limiter;
  /** Pedidos de link de login por e-mail: poucos por minuto. */
  LOGIN_LIMITER: Limiter;
  /** Cada integração liga quando o segredo existe; sem ele, a rota responde 503 e o site explica. */
  NOTION_TOKEN?: string;
  MELHOR_ENVIO_TOKEN?: string;
  MP_ACCESS_TOKEN?: string;
  MP_WEBHOOK_SECRET?: string;
  /** Contas (#29): banco D1 e envio do link de login. Sem EMAIL_FROM (domínio verificado), o login fica desligado. */
  DB?: Db;
  EMAIL?: Mailer;
  EMAIL_FROM: string;
}

export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}
