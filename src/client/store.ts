import type { KeyValue } from '../auth/tokens.ts';
import type { endpoints } from './endpoints.ts';
import { ApiCodeError } from './errors.ts';
import { applyChanges, createPoller, emptyFeed, feedFromMessages, markReadLocal, pruneFeed, realSleep, removeReplyLocal, setReplies, upsertReply } from './feed.ts';
import type { FeedState, Sleep, Update } from './feed.ts';
import type { PendingInvite } from './links.ts';
import { runBackfill } from '../search/backfill.ts';
import { createMessageCache, pruneKehilot } from '../search/cache.ts';
import { resolveHit } from '../search/hit.ts';
import type { Hit } from '../search/hit.ts';
import type { CacheStore, CachedMessage, MessageCache } from '../search/cache.ts';
import { isAdult } from './roles.ts';
import type { Change, Channel, Inbox, Message, Kehila, Lang, Me, NotifyPrefs, PostMessageBody, Reply, UploadGrant } from './types.ts';

type Api = ReturnType<typeof endpoints>;

export type StoreState = {
  /** Bumped by reset(); async results from an older generation are dropped. */
  generation: number;
  me: Me | null;
  kehilaId: string | null;
  kehila: Kehila | null;
  channels: Channel[];
  feed: FeedState;
  /** The private-replies mailbox. Memory only: never written to storage or to the search cache. Null until loaded. */
  inbox: Inbox | null;
  /** Error code of a pending invite that was dropped at start (shown once). */
  joinError: string | null;
  /** Bumped (at most once a second) when the on-device archive changed. */
  archiveRev: number;
};

/** Where the start sequence ends: profile form, join screen, Kehila picker, or the signed-in app. */
export type Route = 'setup' | 'none' | 'switcher' | 'ready';

export const lastKehilaKey = (userId: string) => `kehilot.lastKehila.${userId}`;

const empty = (generation: number): StoreState => ({ generation, me: null, kehilaId: null, kehila: null, channels: [], feed: emptyFeed, inbox: null, joinError: null, archiveRev: 0 });

export type StoreOptions = { sleep?: Sleep; isActive?: () => boolean; pending?: PendingInvite; /** Where the on-phone message cache lives; without it nothing is cached or searchable. */ cacheStore?: CacheStore };

export function createStore(api: Api, storage: KeyValue, opts: StoreOptions = {}) {
  let state = empty(0);
  const listeners = new Set<() => void>();
  const set = (patch: Partial<StoreState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
  const guard = (gen: number) => gen === state.generation;
  const sleep = opts.sleep ?? realSleep;
  const isActive = opts.isActive ?? (() => true);

  // On-phone search cache (spec §3c) of the open Kehila. Visible messages only, never replies.
  let cache: MessageCache | null = null;
  let stopBackfill = new AbortController();
  let backfillToken = 0;
  let backfilling = false;
  const readableIds = () => state.channels.map(c => c.channelId);

  // The archive is re-read by the Messages list only when the cache changed; bursts (backfill pages) collapse to one change a second.
  let archiveTimer: ReturnType<typeof setTimeout> | null = null;
  function touchArchive(): void {
    if (archiveTimer) return;
    archiveTimer = setTimeout(() => { archiveTimer = null; set({ archiveRev: state.archiveRev + 1 }); }, 1000);
    (archiveTimer as { unref?: () => void }).unref?.();
  }

  /** Fills the cache from the oldest saved cursor; a newer run, a Kehila switch or a reset stops this one. */
  function startBackfill(c: MessageCache, k: string, gen: number, supersede: boolean): void {
    if (backfilling && !supersede) return;
    const token = ++backfillToken;
    backfilling = true;
    const signal = stopBackfill.signal;
    const live = () => guard(gen) && cache === c && state.kehilaId === k && token === backfillToken;
    void runBackfill({ api: { messages: (kk, o) => api.messages(kk, o) }, cache: c, k, isActive, sleep: ms => sleep(ms, signal), guard: live })
      .catch(() => { /* offline or server error: the next focus continues from the saved cursor */ })
      .finally(() => { if (token === backfillToken) backfilling = false; });
  }

  /** channels -> ensureChannels (a changed set wipes), then the backfill when it was wiped or is not complete. */
  function syncCache(c: MessageCache, k: string): void {
    const gen = state.generation;
    void c.ensureChannels(readableIds()).then(async r => {
      if (!guard(gen) || cache !== c) return;
      if (r === 'wiped' || !(await c.status()).complete) startBackfill(c, k, gen, r === 'wiped');
    }).catch(() => {});
  }

  /** Feed to cache. Resync wipes and refills; changes are applied in order. */
  function feedToCache(u: Update): void {
    const c = cache;
    const k = state.kehilaId;
    if (!c || !k) return;
    const gen = state.generation;
    const swallow = () => {};
    if ('clear' in u) {
      void c.wipe().then(async () => {
        if (!guard(gen) || cache !== c) return;
        try { const chs = await api.channels(k); if (guard(gen) && cache === c) set({ channels: chs, feed: pruneFeed(state.feed, chs.map(x => x.channelId)) }); } catch { /* keep the known set */ }
        if (!guard(gen) || cache !== c) return;
        await c.ensureChannels(readableIds());
        startBackfill(c, k, gen, true);
      }).catch(swallow);
      return;
    }
    if ('replace' in u) { void c.upsert(u.replace).catch(swallow); return; }
    let batch: Message[] = [];
    const flush = () => { if (batch.length > 0) { void c.upsert(batch).catch(swallow); batch = []; } };
    for (const ch of u.changes as Change[]) {
      if (ch.kind === 'message' || ch.kind === 'join' || ch.kind === 'reply_count') batch.push(ch.item);
      else if (ch.kind === 'message_removed') { flush(); void c.remove([ch.item.id]).catch(swallow); }
    }
    flush();
  }

  /** The one way the feed changes: the poller and the user's own posts both come through here, so the search cache follows. */
  function applyUpdate(u: Update): void {
    feedToCache(u);
    if ('changes' in u && u.changes.some(ch => ch.kind === 'reply' || ch.kind === 'reply_removed')) scheduleInbox();
    set({ feed: 'clear' in u ? emptyFeed : 'replace' in u ? feedFromMessages(u.replace) : applyChanges(state.feed, u.changes) });
  }

  /** The one change-feed poller; started by selectKehila, stopped by reset and on switching away. */
  const poller = createPoller({
    api: { changes: (k, since) => api.changes(k, since) },
    apply: u => applyUpdate(u),
    reload: k => api.messages(k, { limit: 50 }),
    sleep,
    isActive,
  });

  async function loadMe(): Promise<Me | null> {
    const gen = state.generation;
    const me = await api.me();
    if (!guard(gen)) return null;
    set({ me });
    // A Kehila the user left: its cached messages go.
    if (opts.cacheStore) void pruneKehilot(opts.cacheStore, me.userId, me.kehilot.map(x => x.kehilaId)).catch(() => {});
    return me;
  }

  /** Loads the Kehila and its channels; false when the store was reset meanwhile. */
  async function selectKehila(k: string): Promise<boolean> {
    const gen = state.generation;
    const userId = state.me?.userId;
    const [kehila, channels] = await Promise.all([api.kehila(k), api.channels(k)]);
    if (!guard(gen)) return false;
    clearInboxTimer();
    set({ kehilaId: k, kehila, channels, feed: emptyFeed, inbox: null });
    // The cache is set up before the poller starts, so its first operation (ensureChannels) is first in line.
    backfillToken++; backfilling = false;
    cache = opts.cacheStore && userId ? createMessageCache(opts.cacheStore, userId, k, touchArchive) : null;
    if (cache) syncCache(cache, k);
    void poller.start(k, kehila.settings?.pollSeconds ?? 30);
    if (userId) { try { await storage.set(lastKehilaKey(userId), k); } catch { /* the choice is only a convenience */ } }
    return true;
  }

  /** Accepts the stored invite once; on success the new Kehila is opened. Null: nothing happened. */
  async function joinPending(): Promise<Route | null> {
    const pending = opts.pending;
    if (!pending) return null;
    const gen = state.generation;
    const out = await pending.accept(code => api.acceptInvite(code));
    if (!guard(gen)) return 'none';
    if (out.status === 'error') { if (out.removed) set({ joinError: out.code }); return null; }
    if (out.status !== 'joined') return null;
    await loadMe();
    if (!guard(gen)) return 'none';
    return (await selectKehila(out.kehilaId)) ? 'ready' : 'none';
  }

  /** The last Kehila, else the only one, else the switcher; no Kehilot gives 'none'. */
  async function chooseKehila(): Promise<Route> {
    const gen = state.generation;
    const me = state.me;
    if (!me) return 'none';
    if (!me.profile) return 'setup';
    if (me.kehilot.length === 0) return 'none';
    let last: string | null = null;
    try { last = await storage.get(lastKehilaKey(me.userId)); } catch { /* ignore */ }
    if (!guard(gen)) return 'none';
    const pick = me.kehilot.find(x => x.kehilaId === last) ?? (me.kehilot.length === 1 ? me.kehilot[0] : undefined);
    if (!pick) return 'switcher';
    return (await selectKehila(pick.kehilaId)) ? 'ready' : 'none';
  }

  async function start(): Promise<Route> {
    const me = await loadMe();
    if (!me) return 'none';
    if (me.profile && !me.age13Required) { const joined = await joinPending(); if (joined) return joined; }
    return chooseKehila();
  }

  /** With `age13`, the consent is recorded and me() reloaded before the route is computed, so the gate never flashes. */
  async function saveProfile(p: { firstName: string; lastName: string; lang: Lang }, o: { age13?: boolean } = {}): Promise<Route> {
    const gen = state.generation;
    const profile = await api.putProfile(p);
    if (!guard(gen) || !state.me) return 'none';
    set({ me: { ...state.me, profile: { ...state.me.profile, ...profile } } });
    if (o.age13) {
      await api.age13Consent();
      if (!guard(gen)) return 'none';
      if (!(await loadMe()) || !state.me) return 'none';
      set({ me: { ...state.me, profile } });
    }
    return (await joinPending()) ?? chooseKehila();
  }

  /** The age gate: records the consent, reloads me so `age13Required` clears, then joins a waiting invite or picks a Kehila. */
  async function acceptAge13(): Promise<Route> {
    const gen = state.generation;
    await api.age13Consent();
    if (!guard(gen)) return 'none';
    if (!(await loadMe())) return 'none';
    return (await joinPending()) ?? chooseKehila();
  }

  /** Join screen: accepts a code the user is looking at, then opens the Kehila. */
  async function acceptInvite(code: string): Promise<string | null> {
    const gen = state.generation;
    const r = await api.acceptInvite(code);
    if (opts.pending && (await opts.pending.get()) === code) await opts.pending.clear();
    await loadMe();
    if (!guard(gen)) return null;
    return (await selectKehila(r.kehilaId)) ? r.kehilaId : null;
  }

  /** Listener home: ask for membership. A 409 already_requested counts as sent. */
  async function requestMembership(): Promise<void> {
    const gen = state.generation;
    const k = state.kehilaId;
    if (!k) return;
    try { await api.requestMembership(k); } catch (e) { if (!(e instanceof ApiCodeError) || e.code !== 'already_requested') throw e; }
    if (guard(gen) && state.kehila && state.kehilaId === k) set({ kehila: { ...state.kehila, pendingRequest: true } });
  }

  /** After me(): reload the open Kehila when the user's role in it changed (approval, demotion). */
  async function syncRole(): Promise<boolean> {
    const { me, kehila, kehilaId } = state;
    const mine = me?.kehilot.find(x => x.kehilaId === kehilaId);
    if (!mine || !kehila || !kehilaId || mine.role === kehila.role) return false;
    return selectKehila(kehilaId);
  }

  function clearJoinError(): void { set({ joinError: null }); }

  /** After a focus refresh: forget a selected Kehila the user no longer belongs to. */
  function dropMissingSelection(): boolean {
    const { me, kehilaId } = state;
    if (!me || !kehilaId || me.kehilot.some(x => x.kehilaId === kehilaId)) return false;
    poller.stop();
    backfillToken++; backfilling = false; cache = null;
    set({ kehilaId: null, kehila: null, channels: [], feed: emptyFeed });
    return true;
  }

  /** Reload the open Kehila's own record (groups, adminGroups) after a refused admin call. */
  async function refreshKehila(): Promise<void> {
    const c = current();
    if (!c) return;
    const kehila = await api.kehila(c.k);
    if (still(c)) set({ kehila });
  }

  /** On focus: channels(k) again; a changed readable set wipes the cache and refills it. */
  async function refreshChannels(): Promise<void> {
    const c = current();
    const mine = cache;
    if (!c) return;
    const channels = await api.channels(c.k);
    if (!still(c) || cache !== mine) return;
    // Channels no longer readable leave the feed at once, not only the search cache.
    set({ channels, feed: pruneFeed(state.feed, channels.map(x => x.channelId)) });
    if (mine) syncCache(mine, c.k);
  }

  /** Offline search over the cache of the open Kehila; only channels the user can read now (state.channels). */
  async function search(q: string, o: { channelId?: string } = {}): Promise<CachedMessage[]> {
    const c = current();
    const mine = cache;
    if (!c || !mine) return [];
    const hits = await mine.search(q, o);
    const readable = new Set(readableIds());
    return still(c) && cache === mine ? hits.filter(h => readable.has(h.channelId)) : [];
  }
  /** Everything in the on-device archive of the open Kehila that the person can read now. */
  async function archive(): Promise<CachedMessage[]> {
    const c = current();
    const mine = cache;
    if (!c || !mine) return [];
    const hits = await mine.list();
    const readable = new Set(readableIds());
    return still(c) && cache === mine ? hits.filter(h => readable.has(h.channelId)) : [];
  }
  async function cacheStatus(): Promise<{ complete: boolean; count: number }> {
    return cache ? cache.status() : { complete: false, count: 0 };
  }

  /** An older message opened from search: full online (held by the detail view, not put in the feed), else the offline copy. */
  async function loadHit(id: string): Promise<Hit> {
    const c = current();
    if (!c) return { kind: 'notFound' };
    return resolveHit(id, {
      fetch: () => api.message(c.k, id),
      cached: () => cachedMessage(id),
      forget: async () => { await cache?.remove([id]); },
    });
  }

  /** A cached message for the read-only offline copy; never put in the feed. */
  async function cachedMessage(id: string): Promise<CachedMessage | null> {
    const c = current();
    const mine = cache;
    if (!c || !mine) return null;
    const m = await mine.get(id);
    return m && still(c) && cache === mine && readableIds().includes(m.channelId) ? m : null;
  }

  /** Message actions on the open Kehila. Each drops its result if the Kehila changed or the store was reset. */
  function current(): { gen: number; k: string } | null {
    return state.kehilaId ? { gen: state.generation, k: state.kehilaId } : null;
  }
  const still = (c: { gen: number; k: string }) => guard(c.gen) && state.kehilaId === c.k;

  /** Tells the server, then marks the message read on screen; a failed call leaves it unread so the next open retries. */
  async function markRead(m: string): Promise<void> {
    const c = current();
    if (!c || state.feed.messages[m]?.read) return;
    try { await api.markRead(c.k, m); } catch { return; /* stays unread; the next open tries again */ }
    if (still(c)) set({ feed: markReadLocal(state.feed, m) });
  }

  /** Replies live in memory only (feed.replies); never written to storage. The server's list is authoritative. */
  async function loadReplies(m: string): Promise<void> {
    const c = current();
    if (!c) return;
    const list = await api.replies(c.k, m);
    if (still(c)) set({ feed: setReplies(state.feed, m, list) });
  }

  /**
   * Keeps the card's viewer fields in step with my own reply until the feed's `reply_count` brings the server's.
   * `before` is the count when the call began: if the feed changed it meanwhile the server's count already includes
   * this reply and is left alone (never added to).
   */
  function reconcileMine(m: string, before: number | undefined, delta: 1 | -1): void {
    const msg = state.feed.messages[m];
    if (!msg) return;
    const count = msg.replierCount ?? 0;
    const stillMine = state.feed.replies[m]?.some(r => r.authorId === state.me?.userId) ?? false;
    // Repliers are people: deleting one of several old replies by the same person changes nothing.
    const replierCount = count !== (before ?? 0) || (delta < 0 && stillMine) ? count : Math.max(0, count + delta);
    const replied = delta > 0 ? true : stillMine;
    set({ feed: { ...state.feed, messages: { ...state.feed.messages, [m]: { ...msg, replierCount, replied } } } });
  }

  /** The posted reply is added at once from the response; the feed bringing it again replaces it. `to` is `family` or one adult's userId. */
  async function sendReply(m: string, body: string, to?: string): Promise<Reply | null> {
    const c = current();
    if (!c) return null;
    const before = state.feed.messages[m]?.replierCount;
    const reply = await api.postReply(c.k, m, body, to);
    if (still(c)) { set({ feed: upsertReply(state.feed, m, reply) }); reconcileMine(m, before, 1); }
    return reply;
  }

  /** Edit: the text only. The recipient is fixed once sent. */
  async function editReply(m: string, r: string, body: string): Promise<Reply | null> {
    const c = current();
    if (!c) return null;
    const reply = await api.putReply(c.k, m, r, body);
    if (still(c)) set({ feed: upsertReply(state.feed, m, reply) });
    return reply;
  }

  async function deleteReply(m: string, r: string): Promise<void> {
    const c = current();
    if (!c) return;
    const before = state.feed.messages[m]?.replierCount;
    await api.deleteReply(c.k, m, r);
    if (!still(c)) return;
    set({ feed: removeReplyLocal(state.feed, m, r) });
    reconcileMine(m, before, -1);
  }

  /** The mailbox. Adults only (a listener never calls the server). Memory only. */
  async function loadInbox(): Promise<void> {
    const c = current();
    if (!c || !isAdult(state.kehila?.role)) return;
    const inbox = await api.inbox(c.k);
    if (still(c)) set({ inbox });
  }

  let inboxTimer: ReturnType<typeof setTimeout> | null = null;
  function clearInboxTimer(): void { if (inboxTimer) { clearTimeout(inboxTimer); inboxTimer = null; } }
  /** Reloads the mailbox once, 2 s from now; a request inside the window joins it. Never called by listeners. */
  function scheduleInbox(): void {
    if (inboxTimer || !isAdult(state.kehila?.role)) return;
    inboxTimer = setTimeout(() => { inboxTimer = null; void loadInbox().catch(() => {}); }, 2000);
    (inboxTimer as { unref?: () => void }).unref?.();
  }

  /** Tells the server the recipient has seen the replies up to `upTo`, clears their dots on screen and refreshes the mailbox. A failure leaves them unread; the next open tries again. */
  async function markRepliesSeen(m: string, upTo: string): Promise<void> {
    const c = current();
    if (!c || !isAdult(state.kehila?.role)) return;
    try { await api.markRepliesRead(c.k, m, upTo); } catch { return; }
    if (!still(c)) return;
    const list = state.feed.replies[m];
    if (list?.some(r => r.unread && r.replyId <= upTo)) set({ feed: setReplies(state.feed, m, list.map(r => (r.unread && r.replyId <= upTo ? { ...r, unread: false } : r))) });
    scheduleInbox();
  }

  async function join(m: string): Promise<void> {
    const c = current();
    if (!c) return;
    const r = await api.join(c.k, m);
    const msg = state.feed.messages[m];
    if (still(c) && msg) set({ feed: { ...state.feed, messages: { ...state.feed.messages, [m]: { ...msg, joinCount: r.joinCount } } } });
  }

  async function removeMessage(m: string): Promise<void> {
    const c = current();
    if (!c) return;
    await api.removeMessage(c.k, m);
    if (still(c)) void cache?.remove([m]).catch(() => {});
    if (still(c)) set({ feed: applyChanges(state.feed, [{ kind: 'message_removed', id: m, item: { id: m } }]) });
  }

  /** Publishes (or chats); the returned message is applied as a synthetic `message` change, so the poll bringing it again changes nothing. */
  async function postMessage(body: PostMessageBody): Promise<Message> {
    const c = current();
    if (!c) throw new ApiCodeError(0, 'try_again');
    const m = await api.postMessage(c.k, body);
    if (still(c)) applyUpdate({ changes: [{ kind: 'message', id: m.messageId, item: m }] });
    return m;
  }

  /** An upload grant for the open Kehila (presigned; the caller must not log or store it). */
  async function requestUpload(o: { channelId: string; contentType: 'image/jpeg' | 'image/png'; bytes: number }): Promise<UploadGrant> {
    const c = current();
    if (!c) throw new ApiCodeError(0, 'try_again');
    return api.requestUpload(c.k, o);
  }

  /**
   * Notification preferences (M5): shown at once, sent at once, and only the fields of this change go back to
   * their old values when the server refuses (the error is rethrown for the toast).
   */
  let notifySeq = 0;
  const notifyLast = new Map<string, number>();
  async function setNotify(partial: Partial<NotifyPrefs>): Promise<void> {
    const gen = state.generation;
    const k = state.kehilaId;
    const kehila = state.kehila;
    if (!k || !kehila) return;
    const prev = kehila.notify;
    // A later change to the same field owns it: an older failure must not restore over it.
    const mine = new Map<string, number>();
    for (const f of Object.keys(partial)) { const n = ++notifySeq; notifyLast.set(f, n); mine.set(f, n); }
    set({ kehila: { ...kehila, notify: { ...prev, ...partial } } });
    try { await api.putNotify(k, partial); } catch (e) {
      const cur = state.kehila;
      if (guard(gen) && cur && state.kehilaId === k) {
        const back = {} as Record<string, unknown>;
        for (const f of Object.keys(partial) as (keyof NotifyPrefs)[]) if (notifyLast.get(f) === mine.get(f)) back[f] = prev[f];
        set({ kehila: { ...cur, notify: { ...cur.notify, ...back } } });
      }
      throw e;
    }
  }

  /** Me: names and language. The server's answer becomes me.profile (the UI language follows it). */
  async function editProfile(p: { firstName: string; lastName: string; lang: Lang }): Promise<void> {
    const gen = state.generation;
    const profile = await api.putProfile(p);
    if (guard(gen) && state.me) set({ me: { ...state.me, profile: { ...state.me.profile, ...profile } } });
  }

  /** Me: my phone number (E.164) or null to remove it. The server's answer becomes me.profile.phone. */
  async function setPhone(phone: string | null): Promise<void> {
    const gen = state.generation;
    const r = await api.putPhone(phone);
    if (guard(gen) && state.me?.profile) set({ me: { ...state.me, profile: { ...state.me.profile, phone: r.phone } } });
  }

  /** Me: my switch for the open Kehila's phone list. Changes only after the server agrees. */
  async function setShowPhone(show: boolean): Promise<void> {
    const gen = state.generation;
    const k = state.kehilaId;
    if (!k) return;
    const r = await api.putPhoneList(k, show);
    if (guard(gen) && state.kehila && state.kehilaId === k) set({ kehila: { ...state.kehila, showPhone: r.show } });
  }

  /**
   * Leaves a Kehila. The store drops it when it was open, its search cache is wiped, and the route moves to
   * another Kehila (or the picker) or to 'none'. A refusal (409 last_gabbai) is thrown with everything kept.
   */
  async function leaveKehila(k: string): Promise<Route> {
    const gen = state.generation;
    // 404 kehila_not_found: an earlier try already left (a retry after a failed me()).
    try { await api.leave(k); } catch (e) { if (!(e instanceof ApiCodeError) || e.code !== 'kehila_not_found') throw e; }
    if (!guard(gen)) return 'none';
    if (state.kehilaId === k && cache) { try { await cache.wipe(); } catch { /* pruneKehilot below drops it too */ } }
    const me = await loadMe(); // a Kehila missing from me() is wiped from the cache (12b)
    if (!me || !guard(gen)) return 'none';
    dropMissingSelection();
    return chooseKehila();
  }

  function reset(): void {
    poller.stop();
    clearInboxTimer();
    stopBackfill.abort(); stopBackfill = new AbortController();
    backfillToken++; backfilling = false; cache = null;
    state = empty(state.generation + 1);
    listeners.forEach(l => l());
  }

  return {
    getState: () => state,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    loadMe, selectKehila, chooseKehila, start, saveProfile, acceptAge13, acceptInvite, requestMembership, syncRole, clearJoinError, dropMissingSelection, refreshChannels, refreshKehila, search, archive, cacheStatus, cachedMessage, loadHit, reset, guard,
    setNotify, editProfile, setPhone, setShowPhone, leaveKehila, markRead, loadReplies, sendReply, editReply, deleteReply, loadInbox, markRepliesSeen, join, removeMessage, postMessage, requestUpload,
    pollNow: () => poller.pollNow(),
  };
}

export type Store = ReturnType<typeof createStore>;
