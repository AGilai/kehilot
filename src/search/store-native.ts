import { Directory, File, Paths } from 'expo-file-system';
import type { CacheStore } from './cache.ts';

/** One file per key under `Paths.document/kehilot-cache/`; the key is the (URL-encoded) file name. */
export function createNativeStore(): CacheStore {
  const dir = () => new Directory(Paths.document, 'kehilot-cache');
  const file = (key: string) => new File(dir(), encodeURIComponent(key));
  return {
    async get(key) {
      const f = file(key);
      return f.exists ? f.text() : null;
    },
    async set(key, value) {
      const d = dir();
      if (!d.exists) d.create({ idempotent: true });
      const f = file(key);
      if (!f.exists) f.create();
      f.write(value);
    },
    async removePrefix(prefix) {
      const d = dir();
      if (!d.exists) return;
      for (const entry of d.list()) {
        let key: string;
        try { key = decodeURIComponent(entry.name); } catch { key = ''; }
        if (key.startsWith(prefix)) { try { entry.delete(); } catch { /* already gone */ } }
      }
    },
  };
}
