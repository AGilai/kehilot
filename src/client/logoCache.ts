import type { KeyValue } from '../auth/tokens.ts';
import type { endpoints } from './endpoints.ts';

type Api = ReturnType<typeof endpoints>;

export const logoKey = (k: string) => `kehilot.logo.${k}`;

/**
 * Kehila logos as `data:image/png;base64,...` URIs, kept under `kehilot.logo.<k>` as `{v, data}`.
 * The logo is fetched only when `logoVersion` differs from the cached one; `null` means "use the initial-letter tile".
 */
export function createLogoCache(storage: KeyValue) {
  // Per session: one lookup per (Kehila, version), failures included, so renders never re-hit storage or the network.
  const memo = new Map<string, Promise<string | null>>();
  async function lookup(api: Api, k: string, logoVersion: string): Promise<string | null> {
      let cached: { v: string; data: string } | null = null;
      try {
        const raw = await storage.get(logoKey(k));
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.v === 'string' && typeof parsed.data === 'string') cached = parsed;
      } catch { /* unreadable cache: refetch */ }
      if (cached?.v === logoVersion) return cached.data;
      try {
        const logo = await api.logo(k);
        const data = `data:${logo.contentType};base64,${logo.data}`;
        try { await storage.set(logoKey(k), JSON.stringify({ v: logoVersion, data })); } catch { /* cache is optional */ }
        return data;
      } catch {
        return cached?.data ?? null;
      }
  }
  return {
    get(api: Api, k: string, logoVersion: string | null): Promise<string | null> {
      if (!logoVersion) return Promise.resolve(null);
      const key = `${k}:${logoVersion}`;
      let hit = memo.get(key);
      if (!hit) { hit = lookup(api, k, logoVersion); memo.set(key, hit); }
      return hit;
    },
  };
}
