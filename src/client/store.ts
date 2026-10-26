import type { KeyValue } from '../auth/tokens.ts';
import type { endpoints } from './endpoints.ts';
import { ApiCodeError } from './errors.ts';
import { applyChanges, createPoller, emptyFeed, feedFromMessages, markReadLocal, mergeReplies, realSleep } from './feed.ts';
import type { FeedState, Sleep } from './feed.ts';
import type { PendingInvite } from './links.ts';
import type { Channel, Kehila, Lang, Me, Reply } from './types.ts';

type Api = ReturnType<typeof endpoints>;

export type StoreState = {
  /** Bumped by reset(); async results from an older generation are dropped. */
  generation: number;
  me: Me | null;
  kehilaId: string | null;
  kehila: Kehila | null;
  channels: Channel[];
  feed: FeedState;
  /** Error code of a pending invite that was dropped at start (shown once). */
  joinError: string | null;
};

/** Where the start sequence ends: profile form, join screen, Kehila picker, or the signed-in app. */
export type Route = 'setup' | 'none' | 'switcher' | 'ready';

export const lastKehilaKey = (userId: string) => `kehilot.lastKehila.${userId}`;

const empty = (generation: number): StoreState => ({ generation, me: null, kehilaId: null, kehila: null, channels: [], feed: emptyFeed, joinError: null });

export type StoreOptions = { sleep?: Sleep; isActive?: () => boolean; pending?: PendingInvite };

export function createStore(api: Api, storage: KeyValue, opts: StoreOptions = {}) {
  let state = empty(0);
  const listeners = new Set<() => void>();
  const set = (patch: Partial<StoreState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
  const guard = (gen: number) => gen === state.generation;

  /** The one change-feed poller; started by selectKehila, stopped by reset and on switching away. */
  const poller = createPoller({
    api: { changes: (k, since) => api.changes(k, since) },
    apply: u => set({ feed: 'clear' in u ? emptyFeed : 'replace' in u ? feedFromMessages(u.replace) : applyChanges(state.feed, u.changes) }),
    reload: k => api.messages(k, { limit: 50 }),
    sleep: opts.sleep ?? realSleep,
    isActive: opts.isActive ?? (() => true),
  });

  async function loadMe(): Promise<Me | null> {
    const gen = state.generation;
    const me = await api.me();
    if (!guard(gen)) return null;
    set({ me });
    return me;
  }

  /** Loads the Kehila and its channels; false when the store was reset meanwhile. */
  async function selectKehila(k: string): Promise<boolean> {
    const gen = state.generation;
    const userId = state.me?.userId;
    const [kehila, channels] = await Promise.all([api.kehila(k), api.channels(k)]);
    if (!guard(gen)) return false;
    set({ kehilaId: k, kehila, channels, feed: emptyFeed });
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
    if (me.profile) { const joined = await joinPending(); if (joined) return joined; }
    return chooseKehila();
  }

  async function saveProfile(p: { firstName: string; lastName: string; lang: Lang }): Promise<Route> {
    const gen = state.generation;
    const profile = await api.putProfile(p);
    if (!guard(gen) || !state.me) return 'none';
    set({ me: { ...state.me, profile } });
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
    set({ kehilaId: null, kehila: null, channels: [], feed: emptyFeed });
    return true;
  }

  /** Message actions on the open Kehila. Each drops its result if the Kehila changed or the store was reset. */
  function current(): { gen: number; k: string } | null {
    return state.kehilaId ? { gen: state.generation, k: state.kehilaId } : null;
  }
  const still = (c: { gen: number; k: string }) => guard(c.gen) && state.kehilaId === c.k;

  /** Marks a message read at once on screen, then tells the server (a failure is retried on the next open). */
  async function markRead(m: string): Promise<void> {
    const c = current();
    if (!c || state.feed.messages[m]?.read) return;
    set({ feed: markReadLocal(state.feed, m) });
    try { await api.markRead(c.k, m); } catch { /* the next open tries again */ }
  }

  /** Replies live in memory only (feed.replies); never written to storage. */
  async function loadReplies(m: string): Promise<void> {
    const c = current();
    if (!c) return;
    const list = await api.replies(c.k, m);
    if (still(c)) set({ feed: mergeReplies(state.feed, m, list) });
  }

  /** The posted reply is added at once from the response; the feed bringing it again is deduplicated. */
  async function sendReply(m: string, body: string): Promise<Reply | null> {
    const c = current();
    if (!c) return null;
    const reply = await api.postReply(c.k, m, body);
    if (still(c)) set({ feed: mergeReplies(state.feed, m, [reply]) });
    return reply;
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
    if (still(c)) set({ feed: applyChanges(state.feed, [{ kind: 'message_removed', id: m, item: { id: m } }]) });
  }

  function reset(): void {
    poller.stop();
    state = empty(state.generation + 1);
    listeners.forEach(l => l());
  }

  return {
    getState: () => state,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    loadMe, selectKehila, chooseKehila, start, saveProfile, acceptInvite, requestMembership, syncRole, clearJoinError, dropMissingSelection, reset, guard,
    markRead, loadReplies, sendReply, join, removeMessage,
    pollNow: () => poller.pollNow(),
  };
}

export type Store = ReturnType<typeof createStore>;
