import type { TokenManager } from '../auth/tokens.ts';
import { ApiCodeError } from './errors.ts';

export type Http = {
  request<T = any>(method: string, path: string, body?: unknown, opts?: { auth?: boolean }): Promise<T>;
};

type Opts = {
  baseUrl: string;
  tokens: Pick<TokenManager, 'idToken' | 'forceRefresh'>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  onAccountDeleted: () => void;
  onSignedOut: () => void;
};

const RETRIES = 3;
const RETRY_MS = 500;

export function createHttp(o: Opts): Http {
  const doFetch = o.fetch ?? ((u: any, i: any) => fetch(u, i));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = o.timeoutMs ?? 15000;

  async function once(method: string, path: string, body: unknown, token: string | null): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(o.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status === 204) return { status: 204, data: undefined };
      let data: any;
      try {
        data = await res.json();
      } catch {
        data = undefined;
      }
      return { status: res.status, data };
    } catch {
      throw new ApiCodeError(0, 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(method: string, path: string, body?: unknown, opts?: { auth?: boolean }): Promise<T> {
    const auth = opts?.auth !== false;
    let token: string | null = null;
    if (auth) {
      try {
        token = await o.tokens.idToken();
      } catch (e: any) {
        if (e?.code === 'network') throw new ApiCodeError(0, 'network');
        o.onSignedOut();
        throw new ApiCodeError(401, 'unauthorized');
      }
    }
    let retries = 0;
    let refreshed = false;
    for (;;) {
      const { status, data } = await once(method, path, body, token);
      if (status >= 200 && status < 300) return data as T;
      const code: string | undefined = typeof data?.error === 'string' ? data.error : undefined;
      if ((status === 409 || status === 503) && code === 'try_again' && retries < RETRIES) {
        retries++;
        await sleep(RETRY_MS);
        continue;
      }
      if (status === 401 && code === 'account_deleted') {
        o.onAccountDeleted();
        throw new ApiCodeError(401, 'account_deleted');
      }
      if (status === 401 && !code && auth) {
        if (!refreshed) {
          refreshed = true;
          try {
            token = await o.tokens.forceRefresh();
          } catch (e: any) {
            if (e?.code === 'network') throw new ApiCodeError(0, 'network');
            o.onSignedOut();
            throw new ApiCodeError(401, 'unauthorized');
          }
          continue;
        }
        o.onSignedOut();
        throw new ApiCodeError(401, 'unauthorized');
      }
      throw new ApiCodeError(status, code ?? (status === 401 ? 'unauthorized' : 'internal'));
    }
  }

  return { request };
}
