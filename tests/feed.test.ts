import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyChanges, createPoller, emptyFeed, feedFromMessages } from '../src/client/feed.ts';
import type { FeedState, Update } from '../src/client/feed.ts';
import type { Change, ChangesPage, Message, Reply } from '../src/client/types.ts';

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  messageId: id, channelId: 'c1', type: 'chat', title: '', body: `b-${id}`, authorId: 'a', authorName: 'n',
  authorKind: 'member', joinCount: 0, ...over,
});
const reply = (id: string, messageId = 'M1'): Reply & { messageId: string } =>
  ({ replyId: id, messageId, authorId: 'a', authorName: 'n', body: 'x', createdAt: '2026-01-01T00:00:00Z' });
const added = (m: Message): Change => ({ kind: 'message', id: m.messageId, item: m });
const removed = (id: string): Change => ({ kind: 'message_removed', id, item: { id } });
const readOf = (id: string): Change => ({ kind: 'read', id, item: { messageId: id } });

test('apply is idempotent for repeated pages', () => {
  const page: Change[] = [added(msg('M1')), added(msg('M3')), added(msg('M2')),
    { kind: 'join', id: 'M1', item: msg('M1', { joinCount: 2 }) }, readOf('M2'), { kind: 'reply', id: 'r1', item: reply('r1') }];
  const once = applyChanges(emptyFeed, page);
  assert.deepEqual(applyChanges(once, page), once);
  assert.deepEqual(once.order, ['M3', 'M2', 'M1']);
  assert.equal(once.messages.M1?.joinCount, 2);
  assert.equal(once.messages.M2?.read, true);
});

test('reply appended once per replyId', () => {
  const s = applyChanges(emptyFeed, [{ kind: 'reply', id: 'r1', item: reply('r1') }, { kind: 'reply', id: 'r1', item: reply('r1') }, { kind: 'reply', id: 'r2', item: reply('r2') }]);
  assert.deepEqual(s.replies.M1?.map(r => r.replyId), ['r1', 'r2']);
});

test('removed message disappears', () => {
  const s = applyChanges(applyChanges(emptyFeed, [added(msg('M1')), { kind: 'reply', id: 'r1', item: reply('r1') }]), [removed('M1')]);
  assert.deepEqual(s, emptyFeed);
});

test('a message removed later in the same page ends removed', () => {
  const s = applyChanges(emptyFeed, [added(msg('M1')), added(msg('M2')), removed('M1'), { kind: 'join', id: 'M2', item: msg('M2', { joinCount: 1 }) }]);
  assert.deepEqual(s.order, ['M2']);
  assert.equal(s.messages.M1, undefined);
});

test('read for an unknown message is a no-op', () => {
  const base = applyChanges(emptyFeed, [added(msg('M1'))]);
  assert.deepEqual(applyChanges(base, [readOf('nope')]), base);
});

test('a join keeps the local read flag', () => {
  const s = applyChanges(emptyFeed, [added(msg('M1')), readOf('M1'), { kind: 'join', id: 'M1', item: msg('M1', { joinCount: 3 }) }]);
  assert.equal(s.messages.M1?.read, true);
  assert.equal(s.messages.M1?.joinCount, 3);
});

// ---- poller harness ----
function harness(script: (since?: string) => ChangesPage | Error, opts: { active?: () => boolean } = {}) {
  const log: string[] = [];
  const updates: Update[] = [];
  const timers = new Set<number>();
  const sleeps: number[] = [];
  const waiters: (() => void)[] = [];
  let tid = 0;
  const handler = script as (since?: string, k?: string) => ChangesPage | Error;
  const gates: (() => void)[] = [];
  let gateNext: Promise<void> | null = null;
  const api = {
    changes: async (k: string, since?: string) => {
      log.push(`changes:${k}:${since ?? ''}`);
      if (gateNext) { const g = gateNext; gateNext = null; await g; }
      const r = handler(since, k);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const reload = async (k: string) => { log.push(`reload:${k}`); return [msg('M9')]; };
  // sleep that never fires on its own: tests call tick()
  const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
    const id = ++tid; timers.add(id); sleeps.push(ms);
    const fire = () => { if (timers.delete(id)) resolve(); };
    waiters.push(fire);
    signal.addEventListener('abort', () => { timers.delete(id); resolve(); });
  });
  const tick = async () => { const w = waiters.splice(0); w.forEach(f => f()); await flush(); };
  const hold = () => { let open!: () => void; gateNext = new Promise<void>(r => { open = r; }); gates.push(open); return open; };
  const poller = createPoller({ api, apply: u => updates.push(u), reload, sleep, isActive: opts.active ?? (() => true) });
  return { poller, log, updates, timers, sleeps, tick, hold };
}
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r)); };
const page = (cursor: string, changes: Change[] = [], more = false): ChangesPage => ({ cursor, more, changes });

test('cursor taken before initial load', async () => {
  const h = harness(() => page('C0'));
  await h.poller.start('k1', 30);
  assert.deepEqual(h.log.slice(0, 2), ['changes:k1:', 'reload:k1']);
  assert.deepEqual(h.updates[0], { replace: [msg('M9')] });
  h.poller.stop();
});

test('polls every pollSeconds with the stored cursor', async () => {
  let n = 0;
  const h = harness(since => since ? page(`C${++n}`, [added(msg('M1'))]) : page('C0'));
  await h.poller.start('k1', 30);
  await flush();
  assert.deepEqual(h.sleeps, [30000]);
  await h.tick();
  assert.equal(h.log.at(-1), 'changes:k1:C0');
  await h.tick();
  assert.equal(h.log.at(-1), 'changes:k1:C1');
  h.poller.stop();
});

test('more=true fetches again immediately', async () => {
  const pages: Record<string, ChangesPage> = { C0: page('C1', [], true), C1: page('C2', [], false) };
  const h = harness(since => (since ? pages[since]! : page("C0")));
  await h.poller.start('k1', 30);
  await h.tick();
  assert.deepEqual(h.log.slice(-2), ['changes:k1:C0', 'changes:k1:C1']);
  assert.equal(h.sleeps.length, 2); // no sleep between the two pages
  h.poller.stop();
});

test('resync reloads and restarts from a fresh cursor', async () => {
  let resynced = false;
  const h = harness(since => {
    if (since === 'C0' && !resynced) { resynced = true; return { resync: true }; }
    return since ? page('C2') : page(resynced ? 'FRESH' : 'C0');
  });
  await h.poller.start('k1', 30);
  await h.tick();
  assert.deepEqual(h.log.slice(-3), ['changes:k1:C0', 'changes:k1:', 'reload:k1']);
  await h.tick();
  assert.equal(h.log.at(-1), 'changes:k1:FRESH');
  h.poller.stop();
});

test('late page after a Kehila switch is dropped', async () => {
  const h = harness(since => since ? page('Cx', [added(msg('OLD'))]) : page('C0'));
  await h.poller.start('k1', 30);
  const open = h.hold();
  const before = h.updates.length;
  const tick = h.tick();
  await flush();
  const p2 = h.poller.start('k2', 30);
  open();
  await tick; await p2;
  assert.equal(h.updates.slice(before).some(u => 'changes' in u && u.changes.some(c => c.id === 'OLD')), false);
  h.poller.stop();
});

test('error backoff doubles up to 5 minutes and resets', async () => {
  let fail = true;
  const h = harness(since => since ? (fail ? new Error('boom') : page('C1')) : page('C0'));
  await h.poller.start('k1', 100);
  for (let i = 0; i < 4; i++) await h.tick();
  assert.deepEqual(h.sleeps, [100000, 200000, 300000, 300000, 300000]);
  fail = false;
  await h.tick();
  await h.tick();
  assert.equal(h.sleeps.at(-1), 100000);
  h.poller.stop();
});

test('initial failure retries with backoff', async () => {
  let n = 0;
  const h = harness(() => (n++ === 0 ? new Error('down') : page('C0')));
  await h.poller.start('k1', 10);
  await flush();
  assert.equal(h.updates.length, 0);
  await h.tick();
  assert.equal(h.updates.length, 1);
  assert.deepEqual(h.sleeps.slice(0, 2), [20000, 10000]);
  h.poller.stop();
});

test('no polling while inactive', async () => {
  let active = false;
  const h = harness(since => since ? page('C1') : page('C0'), { active: () => active });
  await h.poller.start('k1', 30);
  const calls = h.log.length;
  await h.tick(); await h.tick();
  assert.equal(h.log.length, calls);
  active = true;
  await h.tick();
  assert.ok(h.log.length > calls);
  h.poller.stop();
});

test('stop() during an in-flight poll drops its result and no timer fires after', async () => {
  const h = harness(since => since ? page('C1', [added(msg('LATE'))]) : page('C0'));
  await h.poller.start('k1', 30);
  const open = h.hold();
  const n = h.updates.length;
  const t = h.tick();
  await flush();
  h.poller.stop();
  open();
  await t; await flush();
  assert.equal(h.updates.length, n);
  assert.equal(h.timers.size, 0);
  const calls = h.log.length;
  await h.tick();
  assert.equal(h.log.length, calls);
});

test('timers are cleared by stop()', async () => {
  const h = harness(() => page('C0'));
  await h.poller.start('k1', 30);
  await flush();
  assert.equal(h.timers.size, 1);
  h.poller.stop();
  assert.equal(h.timers.size, 0);
});

test('never two polls at once; pollNow during a poll coalesces', async () => {
  const h = harness(since => { return since ? page('C1') : page('C0'); });
  await h.poller.start('k1', 30);
  const open = h.hold();
  const t = h.tick();
  await flush();
  const a = h.poller.pollNow(), b = h.poller.pollNow();
  open();
  await Promise.all([t, a, b]);
  const polls = h.log.filter(l => l.startsWith('changes:k1:C')).length;
  assert.equal(polls, 1);
  h.poller.stop();
});

test('pollNow polls once outside the timer and does nothing when stopped', async () => {
  const h = harness(since => since ? page('C1', [added(msg('M1'))]) : page('C0'));
  await h.poller.pollNow();
  assert.equal(h.log.length, 0);
  await h.poller.start('k1', 30);
  await h.poller.pollNow();
  assert.equal(h.log.at(-1), 'changes:k1:C0');
  h.poller.stop();
});

test('feedFromMessages sorts newest first', () => {
  const s: FeedState = feedFromMessages([msg('M1'), msg('M3'), msg('M2')]);
  assert.deepEqual(s.order, ['M3', 'M2', 'M1']);
});

test('resync clears the feed before reloading; a failed reload leaves it empty', async () => {
  const log: string[] = [];
  let resync = false, failReload = false;
  const api = { changes: async (_k: string, since?: string) => (since && resync ? { resync: true as const } : page(since ? 'C1' : 'C0')) };
  const timers: (() => void)[] = [];
  const poller = createPoller({
    api,
    apply: u => log.push('clear' in u ? 'clear' : 'replace' in u ? 'replace' : 'changes'),
    reload: async () => { log.push('reload'); if (failReload) throw new Error('x'); return []; },
    sleep: (_ms, signal) => new Promise<void>(res => { timers.push(res); signal.addEventListener('abort', () => res()); }),
    isActive: () => true,
  });
  await poller.start('k1', 30);
  resync = true; failReload = true;
  log.length = 0;
  await poller.pollNow();
  assert.deepEqual(log, ['clear', 'reload']);
  poller.stop();
});

test('loaded is false until the first load, and after a clear', () => {
  assert.equal(emptyFeed.loaded, false);
  const s = feedFromMessages([]);
  assert.equal(s.loaded, true);
  assert.equal(applyChanges(s, [added(msg('M1'))]).loaded, true);
});

test('start works destructured; pollNow success resets backoff', async () => {
  let fail = false;
  const h = harness(since => since ? (fail ? new Error('b') : page('C1')) : page('C0'));
  const { start, stop } = h.poller;
  await start('k1', 10);
  fail = true;
  await h.tick();
  assert.equal(h.sleeps.at(-1), 20000);
  fail = false;
  await h.poller.pollNow();
  await h.tick();
  await h.tick();
  assert.equal(h.sleeps.at(-1), 10000);
  stop();
});

import { markReadLocal, mergeReplies } from '../src/client/feed.ts';

test('mergeReplies dedupes by replyId and keeps order', () => {
  const r = (id: string) => ({ replyId: id, authorId: 'u1', authorName: 'דנה בדויה', body: id, createdAt: '2026-10-26T10:00:00Z' });
  const s0 = { ...feedFromMessages([]), replies: { m1: [r('r1')] } };
  const s1 = mergeReplies(s0, 'm1', [r('r1'), r('r2')]);
  assert.deepEqual(s1.replies.m1!.map(x => x.replyId), ['r1', 'r2']);
  assert.deepEqual(mergeReplies(s1, 'm1', [r('r2')]).replies.m1!.map(x => x.replyId), ['r1', 'r2']);
});

test('markReadLocal sets read once and ignores unknown messages', () => {
  const m = { messageId: 'm1', channelId: 'c', type: 'weekly' as const, title: '', body: '', authorId: 'a', authorName: 'x', authorKind: 'management' as const, joinCount: 0 };
  const s = markReadLocal(feedFromMessages([m]), 'm1');
  assert.equal(s.messages.m1!.read, true);
  assert.equal(markReadLocal(s, 'zz'), s);
});
