import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMessageCache, memoryStore, pruneKehilot, wipeAllCaches } from '../src/search/cache.ts';
import { runBackfill } from '../src/search/backfill.ts';
import type { Message } from '../src/client/types.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(ms: number, n = 0): string {
  let t = ''; let v = ms;
  for (let i = 0; i < 10; i++) { t = CROCKFORD[v % 32] + t; v = Math.floor(v / 32); }
  let r = ''; let x = n;
  for (let i = 0; i < 16; i++) { r = CROCKFORD[x % 32] + r; x = Math.floor(x / 32); }
  return t + r;
}
const T0 = Date.UTC(2026, 0, 10);
const DAY = 86_400_000;
const msg = (ms: number, over: Partial<Message> = {}, n = 0): Message => ({
  messageId: ulid(ms, n), channelId: 'c1', type: 'weekly', title: '', body: '', authorId: 'a', authorName: 'יוסי לדוגמה', authorKind: 'management', joinCount: 0, ...over,
});
async function ready(channels = ['c1', 'c2']) {
  const store = memoryStore();
  const cache = createMessageCache(store, 'u1', 'k1');
  await cache.ensureChannels(channels);
  return { store, cache };
}

test('upsert and search newest first', async () => {
  const { cache } = await ready();
  const a = msg(T0, { title: 'שבת שלום', body: 'קבלת שבת' });
  const b = msg(T0 + 40 * DAY, { title: 'שיעור', body: 'לפני שבת' });
  const c = msg(T0 + 80 * DAY, { title: 'אחר' });
  await cache.upsert([a, c, b]);
  assert.deepEqual((await cache.search('שַׁבָּת', {})).map(m => m.messageId), [b.messageId, a.messageId]);
  assert.deepEqual(await cache.status(), { complete: false, count: 3 });
  assert.deepEqual((await cache.search('שבת', { channelId: 'c2' })), []);
});

test('search covers author and target names, final letters fold', async () => {
  const { cache } = await ready();
  await cache.upsert([msg(T0, { title: 'מזל טוב', targetName: 'בדיוני', authorName: 'דנה בדויה' }, 1)]);
  assert.equal((await cache.search('בדיונ', {})).length, 1);
  assert.equal((await cache.search('דנה', {})).length, 1);
  assert.equal((await cache.search('מזל טוב', {})).length, 1);
  assert.equal((await cache.search('', {})).length, 0);
});

test('all query words must match', async () => {
  const { cache } = await ready();
  await cache.upsert([msg(T0, { title: 'שיעור בגמרא' }, 1), msg(T0 + DAY, { title: 'שיעור בנביא' }, 2)]);
  assert.equal((await cache.search('שיעור גמרא', {})).length, 1);
  assert.equal((await cache.search('שיעור גמרא נביא', {})).length, 0);
});

test('removed message leaves the results, and a late upsert does not bring it back', async () => {
  const { cache } = await ready();
  const a = msg(T0, { title: 'שיעור' }, 1);
  await cache.upsert([a, msg(T0 + DAY, { title: 'שיעור שני' }, 2)]);
  await cache.remove([a.messageId]);
  assert.equal((await cache.search('שיעור', {})).length, 1);
  assert.equal((await cache.status()).count, 1);
  await cache.upsert([a]);
  assert.equal((await cache.search('שיעור', {})).length, 1);
});

test('message from an unreadable channel is not stored', async () => {
  const { cache, store } = await ready(['c1']);
  await cache.upsert([msg(T0, { channelId: 'c9', title: 'סודי' }, 1)]);
  assert.equal((await cache.search('סודי', {})).length, 0);
  assert.equal((await cache.status()).count, 0);
  assert.ok(![...store.data.values()].some(v => v.includes('סודי')));
});

test('channel set change wipes and reports', async () => {
  const { cache, store } = await ready(['c1', 'c2']);
  await cache.upsert([msg(T0, { title: 'שיעור' }, 1)]);
  await cache.saveBackfill({ before: 'x', complete: true });
  assert.equal(await cache.ensureChannels(['c2', 'c1']), 'kept');
  assert.equal((await cache.search('שיעור', {})).length, 1);
  assert.equal(await cache.ensureChannels(['c1', 'c2', 'c3']), 'wiped');
  assert.equal((await cache.search('שיעור', {})).length, 0);
  assert.deepEqual(await cache.status(), { complete: false, count: 0 });
  assert.ok(![...store.data.values()].some(v => v.includes('שיעור')));
  assert.equal(await cache.ensureChannels(['c1']), 'wiped'); // removal wipes too
});

test('replies are never part of the cache', async () => {
  const { cache, store } = await ready();
  await cache.upsert([{ ...msg(T0, { title: 'ברכה' }, 1), replierCount: 3, read: true, image: { contentType: 'image/jpeg', bytes: 5 } } as Message]);
  const raw = [...store.data.values()].join('');
  assert.ok(!raw.includes('replierCount') && !raw.includes('"read"') && !raw.includes('contentType') && !raw.includes('url'));
  assert.equal((await cache.search('ברכה', {}))[0]!.hasImage, true);
});

const noSleep = async () => {};
function pagedApi(total: number) {
  const all = Array.from({ length: total }, (_, i) => msg(T0 + (total - i) * 1000, { title: `הודעה ${i}` }, i)); // newest first
  const calls: Array<{ before?: string; limit?: number }> = [];
  return {
    calls,
    api: {
      messages: async (_k: string, o: { before?: string; limit?: number }) => {
        calls.push(o);
        const start = o.before ? all.findIndex(m => m.messageId === o.before) + 1 : 0;
        return all.slice(start, start + (o.limit ?? 50));
      },
    },
  };
}

test('backfill pages to the end, saves the cursor, sets complete', async () => {
  const { cache } = await ready();
  const { api, calls } = pagedApi(120);
  const waits: number[] = [];
  await runBackfill({ api, cache, k: 'k1', isActive: () => true, sleep: async ms => { waits.push(ms); }, guard: () => true });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.limit), [50, 50, 50]);
  assert.deepEqual(await cache.status(), { complete: true, count: 120 });
  assert.deepEqual(waits, [250, 250]);
});

test('backfill resumes from saved cursor', async () => {
  const { cache, store } = await ready();
  const one = pagedApi(120);
  let stop = false;
  await runBackfill({ api: one.api, cache, k: 'k1', isActive: () => true, sleep: async () => { stop = true; }, guard: () => !stop });
  assert.deepEqual(await cache.status(), { complete: false, count: 50 });
  // A restart: a new cache object on the same store continues after the saved cursor.
  const again = createMessageCache(store, 'u1', 'k1');
  assert.equal(await again.ensureChannels(['c1', 'c2']), 'kept');
  const two = pagedApi(120);
  await runBackfill({ api: two.api, cache: again, k: 'k1', isActive: () => true, sleep: noSleep, guard: () => true });
  assert.ok(two.calls[0]!.before, 'continues from the cursor');
  assert.equal(two.calls.length, 2);
  assert.deepEqual(await again.status(), { complete: true, count: 120 });
});

test('backfill stops on Kehila switch', async () => {
  const { cache } = await ready();
  const { api, calls } = pagedApi(200);
  let on = true;
  await runBackfill({ api, cache, k: 'k1', isActive: () => true, sleep: async () => { on = false; }, guard: () => on });
  assert.equal(calls.length, 1);
  assert.equal((await cache.status()).complete, false);
});

test('backfill pauses while the app is inactive', async () => {
  const { cache } = await ready();
  const { api, calls } = pagedApi(10);
  let active = false; let slept = 0;
  await runBackfill({ api, cache, k: 'k1', isActive: () => active, sleep: async () => { slept++; if (slept === 3) active = true; }, guard: () => true });
  assert.ok(slept >= 3);
  assert.equal(calls.length, 1);
  assert.equal((await cache.status()).complete, true);
});

test('resync wipes and refills', async () => {
  const { cache } = await ready();
  const { api } = pagedApi(60);
  await runBackfill({ api, cache, k: 'k1', isActive: () => true, sleep: noSleep, guard: () => true });
  assert.equal((await cache.status()).complete, true);
  await cache.wipe();
  assert.deepEqual(await cache.status(), { complete: false, count: 0 });
  await cache.ensureChannels(['c1', 'c2']);
  await runBackfill({ api, cache, k: 'k1', isActive: () => true, sleep: noSleep, guard: () => true });
  assert.deepEqual(await cache.status(), { complete: true, count: 60 });
});

test('wipeAll leaves no key behind; pruneKehilot drops Kehilot the user left', async () => {
  const store = memoryStore();
  for (const [u, k] of [['u1', 'k1'], ['u1', 'k2'], ['u2', 'k1']] as const) {
    const c = createMessageCache(store, u, k);
    await c.ensureChannels(['c1']);
    await c.upsert([msg(T0, { title: 'שיעור' }, 1)]);
  }
  await pruneKehilot(store, 'u1', ['k1']);
  assert.equal((await createMessageCache(store, 'u1', 'k2').search('שיעור', {})).length, 0);
  assert.equal((await createMessageCache(store, 'u1', 'k1').search('שיעור', {})).length, 1);
  assert.ok(![...store.data.keys()].some(k => k.startsWith('u1/k2/')));
  await wipeAllCaches(store);
  assert.equal(store.data.size, 0);
});

test('a write in flight at sign-out cannot recreate data after wipeAll', async () => {
  const store = memoryStore();
  const c = createMessageCache(store, 'u1', 'k1');
  await c.ensureChannels(['c1']);
  const pending = c.upsert([msg(T0, { title: 'שיעור' }, 1)]);
  await wipeAllCaches(store);
  await pending;
  assert.equal(store.data.size, 0);
});

test('5000 messages search under 200 ms', async () => {
  const { cache } = await ready();
  const batch: Message[] = [];
  for (let i = 0; i < 5000; i++) {
    batch.push(msg(T0 + i * 3_600_000, { title: `כותרת ${i}`, body: `שיעור מספר ${i} בנושא פרשת השבוע וההלכה המעשית בבית הכנסת`, authorName: i % 7 ? 'יוסי לדוגמה' : 'דנה בדויה' }, i));
  }
  for (let i = 0; i < batch.length; i += 500) await cache.upsert(batch.slice(i, i + 500));
  assert.equal((await cache.status()).count, 5000);
  let best = Infinity; let hits = 0;
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    hits = (await cache.search('שיעור פרשת הלכה 4999', {})).length;
    best = Math.min(best, performance.now() - t);
  }
  assert.equal(hits, 1);
  assert.ok(best < 200, `best of 5 took ${best.toFixed(1)} ms`);
});

test('a backfill page that was in flight during a wipe writes neither messages nor cursor', async () => {
  const { cache } = await ready();
  const { api } = pagedApi(120);
  let stop = false;
  const slow = { messages: async (k: string, o: { before?: string; limit?: number }) => {
    const page = await api.messages(k, o);
    await cache.ensureChannels(['c1', 'c2', 'c3']); // a focus check wipes while the page is in flight
    return page;
  } };
  await runBackfill({ api: slow, cache, k: 'k1', isActive: () => true, sleep: async () => { stop = true; }, guard: () => !stop }).catch(() => {});
  const st = await cache.backfillState();
  assert.equal(st.before, null);
  assert.equal(st.complete, false);
  assert.equal((await cache.status()).count, 0);
  // The next run starts from the newest message.
  const next = pagedApi(60);
  await runBackfill({ api: next.api, cache, k: 'k1', isActive: () => true, sleep: noSleep, guard: () => true });
  assert.equal(next.calls[0]!.before, undefined);
  assert.deepEqual(await cache.status(), { complete: true, count: 60 });
});

test('get returns one cached message', async () => {
  const { cache } = await ready();
  const a = msg(T0, { title: 'שיעור' }, 1);
  await cache.upsert([a]);
  assert.equal((await cache.get(a.messageId))?.title, 'שיעור');
  assert.equal(await cache.get(msg(T0, {}, 9).messageId), null);
});
