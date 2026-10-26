import type { CacheStore } from './cache.ts';

const DB = 'kehilot-cache';
const STORE = 'kv';

/** IndexedDB database `kehilot-cache`, object store `kv` (key to string), no library. */
export function createWebStore(): CacheStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  }));
  async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  return {
    async get(key) {
      const v = await tx('readonly', s => s.get(key));
      return typeof v === 'string' ? v : null;
    },
    async set(key, value) { await tx('readwrite', s => { s.put(value, key); }); },
    async removePrefix(prefix) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const req = t.objectStore(STORE).openKeyCursor(prefix ? IDBKeyRange.bound(prefix, prefix + '\uffff') : undefined);
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return;
          if (typeof c.key === 'string' && c.key.startsWith(prefix)) t.objectStore(STORE).delete(c.key);
          c.continue();
        };
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },
  };
}
