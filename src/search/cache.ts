import { ulidTime } from '../client/messageView.ts';
import type { Message, MessageType } from '../client/types.ts';
import { normalize, queryWords } from './normalize.ts';

/** Where the cache keeps its data: memory in tests, files on a phone, IndexedDB on the web. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Removes every key that starts with `prefix`; the empty prefix removes everything. */
  removePrefix(prefix: string): Promise<void>;
}

export function memoryStore(): CacheStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async k => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v); },
    removePrefix: async p => { for (const k of [...data.keys()]) if (k.startsWith(p)) data.delete(k); },
  };
}

/**
 * What is kept of a message: text only. Never replies, read flags, reply counts or image URLs (spec §3c).
 * `norm` is the normalised title, body, author name and target name that search scans.
 */
export type CachedMessage = {
  messageId: string;
  channelId: string;
  type: MessageType;
  title: string;
  body: string;
  authorName: string;
  targetName?: string;
  hasImage: boolean;
  norm: string;
};

type Meta = { v: 1; channels: string; complete: boolean; before: string | null; count: number };

const epochs = new WeakMap<CacheStore, number>();
const epochOf = (s: CacheStore) => epochs.get(s) ?? 0;

const locks = new WeakMap<CacheStore, Promise<unknown>>();
/** Serialises read-modify-write of the per-user Kehila index across caches of one store. */
function withIndexLock<T>(store: CacheStore, fn: () => Promise<T>): Promise<T> {
  const p = (locks.get(store) ?? Promise.resolve()).then(fn);
  locks.set(store, p.catch(() => {}));
  return p;
}

const indexKey = (userId: string) => `${userId}/index`;
async function readIndex(store: CacheStore, userId: string): Promise<string[]> {
  try {
    const v = JSON.parse((await store.get(indexKey(userId))) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/**
 * Sign-out: removes every key under every user. Caches created before this call stop writing, so a write
 * that was queued at that moment cannot bring data back.
 */
export async function wipeAllCaches(store: CacheStore): Promise<void> {
  epochs.set(store, epochOf(store) + 1);
  await store.removePrefix('');
}

/** After me(): wipes the cache of every Kehila the user no longer belongs to and drops it from the index. */
export async function pruneKehilot(store: CacheStore, userId: string, keep: string[]): Promise<void> {
  await withIndexLock(store, async () => {
    const index = await readIndex(store, userId);
    const gone = index.filter(k => !keep.includes(k));
    if (gone.length === 0) return;
    for (const k of gone) await store.removePrefix(`${userId}/${k}/`);
    await store.set(indexKey(userId), JSON.stringify(index.filter(k => keep.includes(k))));
  });
}

const monthOf = (messageId: string): string => {
  const ms = ulidTime(messageId);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 7) : 'unknown';
};

function toCached(m: Message): CachedMessage {
  const c: CachedMessage = {
    messageId: m.messageId, channelId: m.channelId, type: m.type, title: m.title, body: m.body, authorName: m.authorName,
    hasImage: !!m.image,
    norm: normalize([m.title, m.body, m.authorName, m.targetName].filter(Boolean).join(' ')),
  };
  if (m.targetName) c.targetName = m.targetName;
  return c;
}

export function createMessageCache(store: CacheStore, userId: string, k: string) {
  const base = `${userId}/${k}`;
  const metaKey = `${base}/meta`;
  const monthsKey = `${base}/months`;
  const monthKey = (month: string) => `${base}/m/${month}`;
  const epoch0 = epochOf(store);
  const dead = () => epochOf(store) !== epoch0;
  const put = async (key: string, value: string) => { if (!dead()) await store.set(key, value); };

  let tail: Promise<unknown> = Promise.resolve();
  /** One operation at a time, in call order: the poller and the backfill both write. */
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = tail.then(fn);
    tail = p.catch(() => {});
    return p;
  };

  let meta: Meta | null | undefined;
  let monthList: string[] | undefined;
  const months = new Map<string, Record<string, CachedMessage>>();
  const removed = new Set<string>();
  /** Bumped by every wipe; a backfill page started before a wipe must not write into the fresh cache. */
  let wipes = 0;

  async function loadMeta(): Promise<Meta | null> {
    if (meta !== undefined) return meta;
    try {
      const v = JSON.parse((await store.get(metaKey)) ?? 'null');
      meta = v && v.v === 1 && typeof v.channels === 'string' ? (v as Meta) : null;
    } catch { meta = null; }
    return meta;
  }
  async function loadMonthList(): Promise<string[]> {
    if (monthList) return monthList;
    try {
      const v = JSON.parse((await store.get(monthsKey)) ?? '[]');
      monthList = Array.isArray(v) ? v : [];
    } catch { monthList = []; }
    return monthList!;
  }
  async function loadMonth(month: string): Promise<Record<string, CachedMessage>> {
    let rec = months.get(month);
    if (!rec) {
      try { rec = JSON.parse((await store.get(monthKey(month))) ?? '{}') as Record<string, CachedMessage>; } catch { rec = {}; }
      months.set(month, rec);
    }
    return rec;
  }
  const saveMeta = (m: Meta) => put(metaKey, JSON.stringify(m));

  async function wipeNow(): Promise<void> {
    if (!dead()) await store.removePrefix(`${base}/`);
    meta = null; monthList = []; months.clear(); removed.clear(); wipes++;
    await withIndexLock(store, async () => {
      const index = await readIndex(store, userId);
      if (index.includes(k)) await put(indexKey(userId), JSON.stringify(index.filter(x => x !== k)));
    });
  }

  return {
    /** Stores messages of readable channels; anything else (and anything removed this session) is skipped. */
    upsert(messages: Message[], wipeGen?: number): Promise<void> {
      return run(async () => {
        const m = await loadMeta();
        if (!m || dead() || (wipeGen !== undefined && wipeGen !== wipes)) return;
        const allowed = new Set(m.channels ? m.channels.split(',') : []);
        const byMonth = new Map<string, Message[]>();
        for (const msg of messages) {
          if (!allowed.has(msg.channelId) || removed.has(msg.messageId)) continue;
          const mo = monthOf(msg.messageId);
          byMonth.set(mo, [...(byMonth.get(mo) ?? []), msg]);
        }
        if (byMonth.size === 0) return;
        const list = await loadMonthList();
        let listChanged = false;
        for (const [mo, items] of byMonth) {
          const rec = await loadMonth(mo);
          for (const msg of items) {
            if (!(msg.messageId in rec)) m.count++;
            rec[msg.messageId] = toCached(msg);
          }
          await put(monthKey(mo), JSON.stringify(rec));
          if (!list.includes(mo)) { list.push(mo); listChanged = true; }
        }
        if (listChanged) await put(monthsKey, JSON.stringify(list));
        await saveMeta(m);
      });
    },

    remove(ids: string[]): Promise<void> {
      return run(async () => {
        for (const id of ids) removed.add(id);
        const m = await loadMeta();
        if (!m || dead()) return;
        const touched = new Set<string>();
        for (const id of ids) {
          const mo = monthOf(id);
          const rec = await loadMonth(mo);
          if (id in rec) { delete rec[id]; m.count--; touched.add(mo); }
        }
        for (const mo of touched) await put(monthKey(mo), JSON.stringify(months.get(mo)));
        if (touched.size > 0) await saveMeta(m);
      });
    },

    /** Any difference from the stored channel set wipes this Kehila's data. A new cache starts as 'kept'. */
    ensureChannels(readableIds: string[]): Promise<'kept' | 'wiped'> {
      return run(async () => {
        const channels = [...readableIds].sort().join(',');
        const m = await loadMeta();
        let result: 'kept' | 'wiped' = 'kept';
        if (m && m.channels === channels) return result;
        if (m) { await wipeNow(); result = 'wiped'; }
        meta = { v: 1, channels, complete: false, before: null, count: 0 };
        await saveMeta(meta);
        await withIndexLock(store, async () => {
          const index = await readIndex(store, userId);
          if (!index.includes(k)) await put(indexKey(userId), JSON.stringify([...index, k]));
        });
        return result;
      });
    },

    /** Every word must occur; newest first. */
    search(q: string, o: { channelId?: string } = {}, limit = 200): Promise<CachedMessage[]> {
      return run(async () => {
        const words = queryWords(q);
        if (words.length === 0 || !(await loadMeta())) return [];
        const hits: CachedMessage[] = [];
        for (const mo of await loadMonthList()) {
          for (const msg of Object.values(await loadMonth(mo))) {
            if (o.channelId && msg.channelId !== o.channelId) continue;
            if (words.every(w => msg.norm.includes(w))) hits.push(msg);
          }
        }
        hits.sort((a, b) => (a.messageId < b.messageId ? 1 : a.messageId > b.messageId ? -1 : 0));
        return hits.slice(0, limit);
      });
    },

    /** One cached message (offline copy for the detail screen), or null. */
    get(id: string): Promise<CachedMessage | null> {
      return run(async () => ((await loadMeta()) ? ((await loadMonth(monthOf(id)))[id] ?? null) : null));
    },

    status(): Promise<{ complete: boolean; count: number }> {
      return run(async () => {
        const m = await loadMeta();
        return { complete: m?.complete ?? false, count: m?.count ?? 0 };
      });
    },

    /** Where the backfill stands: the oldest message id fetched so far. */
    backfillState(): Promise<{ before: string | null; complete: boolean; wipeGen: number }> {
      return run(async () => {
        const m = await loadMeta();
        return { before: m?.before ?? null, complete: m?.complete ?? false, wipeGen: wipes };
      });
    },
    /** Saved after every page. Does nothing when the cache was wiped meanwhile. */
    saveBackfill(s: { before: string | null; complete: boolean; wipeGen?: number }): Promise<void> {
      return run(async () => {
        const m = await loadMeta();
        if (!m || dead() || (s.wipeGen !== undefined && s.wipeGen !== wipes)) return;
        m.before = s.before; m.complete = s.complete;
        await saveMeta(m);
      });
    },

    wipe(): Promise<void> { return run(wipeNow); },
  };
}

export type MessageCache = ReturnType<typeof createMessageCache>;
