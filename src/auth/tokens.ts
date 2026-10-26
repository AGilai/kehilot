import { AuthError } from './cognito.ts';

export type Tokens = { idToken: string; refreshToken: string; expiresAt: number };

export interface KeyValue {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  remove(k: string): Promise<void>;
}

export type TokenManager = {
  setSession(t: Tokens): Promise<void>;
  restore(): Promise<boolean>;
  idToken(): Promise<string>;
  forceRefresh(): Promise<string>;
  claims(): { sub: string; email: string };
  clear(): Promise<void>;
};

export const REFRESH_KEY = 'kehilot.refresh.v1';
const SKEW_MS = 60_000;

function decodeClaims(idToken: string): { sub: string; email: string } {
  try {
    const part = idToken.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    return { sub: String(p.sub ?? ''), email: String(p.email ?? '') };
  } catch {
    return { sub: '', email: '' };
  }
}

export function createTokenManager(opts: {
  storage: KeyValue;
  refresh: (refreshToken: string) => Promise<{ idToken: string; expiresIn: number }>;
  now?: () => number;
  onSignedOut: () => void;
}): TokenManager {
  const now = opts.now ?? (() => Date.now());
  let refreshToken: string | null = null;
  let id: string | null = null;
  let expiresAt = 0;
  let inflight: Promise<string> | null = null;
  // Bumped by clear() and setSession(). A refresh result is applied only if the generation is unchanged;
  // otherwise the late result is dropped and its callers get AuthError('signed_out').
  let generation = 0;

  async function clear(): Promise<void> {
    generation++;
    inflight = null;
    refreshToken = null;
    id = null;
    expiresAt = 0;
    await opts.storage.remove(REFRESH_KEY);
  }

  function doRefresh(): Promise<string> {
    if (inflight) return inflight;
    const rt = refreshToken;
    const gen = generation;
    if (!rt) return Promise.reject(new AuthError('signed_out'));
    inflight = (async () => {
      try {
        const r = await opts.refresh(rt);
        if (gen !== generation) throw new AuthError('signed_out');
        id = r.idToken;
        expiresAt = now() + r.expiresIn * 1000;
        return r.idToken;
      } catch (e) {
        if (gen !== generation && !(e instanceof AuthError && e.code === 'signed_out')) throw new AuthError('signed_out');
        if (e instanceof AuthError && e.code === 'NotAuthorizedException') {
          await clear();
          opts.onSignedOut();
          throw new AuthError('signed_out');
        }
        throw e;
      } finally {
        if (gen === generation) inflight = null;
      }
    })();
    return inflight;
  }

  return {
    async setSession(t) {
      generation++;
      inflight = null;
      refreshToken = t.refreshToken;
      id = t.idToken;
      expiresAt = t.expiresAt;
      await opts.storage.set(REFRESH_KEY, t.refreshToken);
    },
    async restore() {
      const stored = await opts.storage.get(REFRESH_KEY);
      if (!stored) return false;
      refreshToken = stored;
      try {
        await doRefresh();
        return true;
      } catch (e) {
        if (e instanceof AuthError && e.code === 'signed_out') return false;
        throw e;
      }
    },
    async idToken() {
      if (id && expiresAt - now() >= SKEW_MS) return id;
      return doRefresh();
    },
    forceRefresh: doRefresh,
    claims() {
      return id ? decodeClaims(id) : { sub: '', email: '' };
    },
    clear,
  };
}
