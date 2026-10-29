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
  ({ replyId: id, messageId, authorId: 'a', authorName: 'n', body: 'x', createdAt: 1767225600, to: 'author' });
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

import { markReadLocal, removeReplyLocal, setReplies, upsertReply } from '../src/client/feed.ts';

const rep = (id: string, body = id, over: Partial<Reply> = {}): Reply => ({ replyId: id, authorId: 'u1', authorName: 'דנה בדויה', body, createdAt: 1793008800, to: 'author', ...over });

test('a reply change with a known replyId replaces it', () => {
  const s0 = applyChanges(emptyFeed, [{ kind: 'reply', id: 'r1', item: { ...reply('r1'), body: 'לפני' } }, { kind: 'reply', id: 'r2', item: reply('r2') }]);
  const s1 = applyChanges(s0, [{ kind: 'reply', id: 'r1', item: { ...reply('r1'), body: 'אחרי', updatedAt: 1793009000 } }]);
  assert.deepEqual(s1.replies.M1?.map(r => r.replyId), ['r1', 'r2']);
  assert.equal(s1.replies.M1?.[0]?.body, 'אחרי');
  assert.equal(s1.replies.M1?.[0]?.updatedAt, 1793009000);
  assert.equal((s1.replies.M1?.[0] as any).messageId, undefined);
});

test('reply_removed removes the reply', () => {
  const s0 = applyChanges(emptyFeed, [{ kind: 'reply', id: 'r1', item: reply('r1') }, { kind: 'reply', id: 'r2', item: reply('r2') }]);
  const page: Change[] = [{ kind: 'reply_removed', id: 'r1', item: { id: 'r1', messageId: 'M1' } }];
  const s1 = applyChanges(s0, page);
  assert.deepEqual(s1.replies.M1?.map(r => r.replyId), ['r2']);
  assert.deepEqual(applyChanges(s1, page), s1); // idempotent
  assert.deepEqual(applyChanges(emptyFeed, page), emptyFeed); // unknown message: nothing appears
  assert.deepEqual(applyChanges(s1, [{ kind: 'reply_removed', id: 'zz', item: { id: 'zz', messageId: 'M1' } }]), s1);
});

test('setReplies replaces a stale list', () => {
  const s0 = { ...feedFromMessages([]), replies: { m1: [rep('r1'), rep('r2')], m2: [rep('r9')] } };
  const s1 = setReplies(s0, 'm1', [rep('r2', 'חדש'), rep('r3')]);
  assert.deepEqual(s1.replies.m1!.map(x => x.replyId), ['r2', 'r3']); // r1 was deleted on the server
  assert.equal(s1.replies.m1![0]!.body, 'חדש');
  assert.deepEqual(s1.replies.m2!.map(x => x.replyId), ['r9']);
  assert.deepEqual(setReplies(s1, 'm1', []).replies.m1, []);
});

test('upsertReply adds or replaces; removeReplyLocal drops', () => {
  const s0 = upsertReply(feedFromMessages([]), 'm1', rep('r1', 'א'));
  const s1 = upsertReply(s0, 'm1', rep('r1', 'ב'));
  assert.deepEqual(s1.replies.m1!.map(x => x.body), ['ב']);
  const s2 = upsertReply(s1, 'm1', rep('r2'));
  assert.deepEqual(removeReplyLocal(s2, 'm1', 'r1').replies.m1!.map(x => x.replyId), ['r2']);
  assert.equal(removeReplyLocal(s2, 'm1', 'nope'), s2);
  assert.equal(removeReplyLocal(s2, 'zz', 'r1'), s2);
});

test('markReadLocal sets read once and ignores unknown messages', () => {
  const m = { messageId: 'm1', channelId: 'c', type: 'weekly' as const, title: '', body: '', authorId: 'a', authorName: 'x', authorKind: 'management' as const, joinCount: 0 };
  const s = markReadLocal(feedFromMessages([m]), 'm1');
  assert.equal(s.messages.m1!.read, true);
  assert.equal(markReadLocal(s, 'zz'), s);
});

test('pruneFeed keeps only messages (and replies) of readable channels', async () => {
  const { pruneFeed } = await import('../src/client/feed.ts');
  const m = (id: string, channelId: string) => ({ messageId: id, channelId, type: 'weekly', title: 't', body: '', authorId: 'a', authorName: 'n', authorKind: 'management', joinCount: 0 }) as any;
  const f = { ...feedFromMessages([m('01A', 'c1'), m('01B', 'c2')]), replies: { '01A': [], '01B': [{ replyId: 'r', authorId: 'a', authorName: 'n', body: 'x', createdAt: 1, to: 'author' }] } };
  const out = pruneFeed(f, ['c1']);
  assert.deepEqual(out.order, ['01A']);
  assert.deepEqual(Object.keys(out.replies), ['01A']);
  assert.equal(pruneFeed(f, ['c1', 'c2']), f); // nothing to drop: same object
});

test('a reply_count change keeps replyAdults and replyBlocked it does not carry', () => {
  const adults = [{ userId: 'u1', name: 'שולמית פלוני' }];
  const s0 = feedFromMessages([msg('M1', { replyAdults: adults, replyBlocked: 'target_left' })]);
  const s1 = applyChanges(s0, [{ kind: 'reply_count', id: 'M1', item: msg('M1', { replierCount: 4 }) }]);
  assert.equal(s1.messages.M1?.replierCount, 4);
  assert.deepEqual(s1.messages.M1?.replyAdults, adults);
  assert.equal(s1.messages.M1?.replyBlocked, 'target_left');
  const s2 = applyChanges(s1, [{ kind: 'message', id: 'M1', item: msg('M1', { replyAdults: [] }) }]);
  assert.deepEqual(s2.messages.M1?.replyAdults, []); // a carried value wins
});

test('bump moves an old message to the top and marks it unread', () => {
  const start = applyChanges(emptyFeed, [added(msg('M3')), added(msg('M2')), added(msg('M1', { read: true }))]);
  assert.deepEqual(start.order, ['M3', 'M2', 'M1']);
  const bumped = added(msg('M1', { bumpId: 'M9', updatedAt: 1767225600 }));
  const once = applyChanges(start, [bumped]);
  assert.deepEqual(once.order, ['M1', 'M3', 'M2']);
  assert.equal(once.messages.M1?.read, false);
  const twice = applyChanges(once, [bumped]);
  assert.deepEqual(twice, once);
  // the user opens it, then the same page arrives again: it stays read
  const read = applyChanges(once, [readOf('M1')]);
  assert.equal(applyChanges(read, [bumped]).messages.M1?.read, true);
});

test('a non-bump update keeps order and read', () => {
  const start = applyChanges(emptyFeed, [added(msg('M3')), added(msg('M2')), added(msg('M1', { read: true }))]);
  const next = applyChanges(start, [added(msg('M1', { updatedAt: 1767225600, title: 'new' }))]);
  assert.deepEqual(next.order, ['M3', 'M2', 'M1']);
  assert.equal(next.messages.M1?.read, true);
  assert.equal(next.messages.M1?.title, 'new');
});

test('feedFromMessages sorts by the bump id', () => {
  const s = feedFromMessages([msg('M1', { bumpId: 'M9' }), msg('M3'), msg('M2')]);
  assert.deepEqual(s.order, ['M1', 'M3', 'M2']);
});

test('a bumped message that arrives on two pages is one entry at its bumped position', () => {
  const bumped = msg('M1', { bumpId: 'M9' });
  const page1 = [bumped, msg('M3'), msg('M2')];
  const page2 = [msg('M2'), msg('M1', { bumpId: 'M9' }), msg('M0')];
  const s = feedFromMessages([...page1, ...page2]);
  assert.deepEqual(s.order, ['M1', 'M3', 'M2', 'M0']);
  // a stale copy without the bump, arriving later, does not undo it
  assert.deepEqual(feedFromMessages([bumped, msg('M3'), msg('M1')]).order, ['M1', 'M3']);
  // the change feed repeating the bumped message does not duplicate it either
  const again = applyChanges(s, [added(bumped), added(msg('M0'))]);
  assert.deepEqual(again.order, ['M1', 'M3', 'M2', 'M0']);
});
