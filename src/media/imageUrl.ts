import { ApiCodeError } from '../client/errors.ts';

export const REUSE_MARGIN_MS = 30_000;

type Grant = { url: string; expiresAt: string };

/**
 * Presigned image GET URLs, in memory only: reused until 30 s before `expiresAt`, one request at a time
 * per message. A message without an image (404 `not_found`) gives null. The URL is never logged or stored.
 */
export function createImageUrls(api: { messageImage(k: string, m: string): Promise<Grant> }, now: () => number = Date.now) {
  const cache = new Map<string, { url: string; until: number }>();
  const inflight = new Map<string, Promise<string | null>>();
  return {
    get(k: string, m: string): Promise<string | null> {
      const key = `${k}:${m}`;
      const hit = cache.get(key);
      if (hit && now() < hit.until) return Promise.resolve(hit.url);
      const running = inflight.get(key);
      if (running) return running;
      const p = (async () => {
        try {
          const g = await api.messageImage(k, m);
          cache.set(key, { url: g.url, until: Date.parse(g.expiresAt) - REUSE_MARGIN_MS });
          return g.url;
        } catch (e) {
          cache.delete(key);
          if (e instanceof ApiCodeError && e.code === 'not_found') return null;
          throw e;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
    /** Forget everything (sign-out, leaving a Kehila). */
    clear() { cache.clear(); },
  };
}
export type ImageUrls = ReturnType<typeof createImageUrls>;
