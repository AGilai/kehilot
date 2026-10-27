import type { Change, ChangesPage, Message, Reply } from './types.ts';

export type FeedState = {
  messages: Record<string, Message>;
  /** Message IDs, newest first (ULIDs sort by time). */
  order: string[];
  replies: Record<string, Reply[]>;
  /** False until the initial (or resync) load succeeds, so the UI can tell loading from empty. */
  loaded: boolean;
};

export const emptyFeed: FeedState = { messages: {}, order: [], replies: {}, loaded: false };

const byNewest = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

export function feedFromMessages(list: Message[]): FeedState {
  const messages: Record<string, Message> = {};
  for (const m of list) messages[m.messageId] = m;
  return { messages, order: Object.keys(messages).sort(byNewest), replies: {}, loaded: true };
}

/** Applies a page in order. Pure and idempotent: a repeated page gives the same state. */
export function applyChanges(state: FeedState, changes: Change[]): FeedState {
  const messages = { ...state.messages };
  const replies = { ...state.replies };
  let order = state.order;
  for (const c of changes) {
    switch (c.kind) {
      case 'message':
      case 'join':
      case 'reply_count': {
        const prev = messages[c.item.messageId];
        const read = c.item.read ?? prev?.read;
        messages[c.item.messageId] = read === undefined ? c.item : { ...c.item, read };
        if (!prev) order = [...order, c.item.messageId].sort(byNewest);
        break;
      }
      case 'message_removed':
        delete messages[c.item.id];
        delete replies[c.item.id];
        order = order.filter(id => id !== c.item.id);
        break;
      case 'reply': {
        const { messageId, ...r } = c.item;
        const list = replies[messageId] ?? [];
        if (!list.some(x => x.replyId === r.replyId)) replies[messageId] = [...list, r];
        break;
      }
      case 'read': {
        const m = messages[c.item.messageId];
        if (m && !m.read) messages[c.item.messageId] = { ...m, read: true };
        break;
      }
    }
  }
  return { messages, order, replies, loaded: state.loaded };
}

/** Drops the messages (and their replies) of channels that are not in `readable`; the same object when nothing goes. */
export function pruneFeed(state: FeedState, readable: string[]): FeedState {
  const ok = new Set(readable);
  const gone = state.order.filter(id => !ok.has(state.messages[id]?.channelId ?? ''));
  if (gone.length === 0 && Object.keys(state.replies).every(id => id in state.messages)) return state;
  const messages: FeedState['messages'] = {};
  const replies: FeedState['replies'] = {};
  const order = state.order.filter(id => ok.has(state.messages[id]?.channelId ?? ''));
  for (const id of order) { messages[id] = state.messages[id]!; if (state.replies[id]) replies[id] = state.replies[id]!; }
  return { messages, order, replies, loaded: state.loaded };
}

/** Adds replies fetched for one message; deduplicated by replyId, kept in the order they arrived. */
export function mergeReplies(state: FeedState, messageId: string, list: Reply[]): FeedState {
  const have = state.replies[messageId] ?? [];
  const seen = new Set(have.map(r => r.replyId));
  const fresh = list.filter(r => !seen.has(r.replyId) && seen.add(r.replyId));
  if (fresh.length === 0 && messageId in state.replies) return state;
  return { ...state, replies: { ...state.replies, [messageId]: [...have, ...fresh] } };
}

export function markReadLocal(state: FeedState, messageId: string): FeedState {
  const m = state.messages[messageId];
  if (!m || m.read) return state;
  return { ...state, messages: { ...state.messages, [messageId]: { ...m, read: true } } };
}

/** What the poller hands to the store: a full replacement (initial load, resync) or a page of changes. */
export type Update = { replace: Message[] } | { clear: true } | { changes: Change[] };

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** Real sleep: resolves after ms, or at once on abort; the timer is cleared either way. */
export const realSleep: Sleep = (ms, signal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); };
  const t = setTimeout(done, ms);
  (t as { unref?: () => void }).unref?.(); // Node: an idle poll timer must not keep the process alive
  signal.addEventListener('abort', done);
});

export const MAX_BACKOFF_MS = 5 * 60 * 1000;

export type PollerDeps = {
  api: { changes(k: string, since?: string): Promise<ChangesPage> };
  apply(update: Update): void;
  /** Loads the newest messages of a Kehila (`messages(k, {limit: 50})`). */
  reload(k: string): Promise<Message[]>;
  sleep: Sleep;
  isActive(): boolean;
};

export function createPoller(deps: PollerDeps) {
  let gen = 0;
  let kehila: string | null = null;
  let cursor: string | null = null;
  let abort: AbortController | null = null;
  let inflight: Promise<void> | null = null;
  let healthy = true;
  let delay = 0;

  /** One poll (or the initial load when there is no cursor). Throws on error; drops stale results. */
  async function runOnce(g: number, k: string): Promise<void> {
    const stale = () => g !== gen;
    // The cursor is taken before the load, so nothing committed in between is missed.
    const loadFresh = async () => {
      const first = await deps.api.changes(k);
      if (stale()) return;
      if ('resync' in first) throw new Error('unexpected resync');
      const messages = await deps.reload(k);
      if (stale()) return;
      cursor = first.cursor;
      deps.apply({ replace: messages });
    };
    if (cursor === null) return loadFresh();
    for (;;) {
      const res = await deps.api.changes(k, cursor);
      if (stale()) return;
      if ('resync' in res) { cursor = null; deps.apply({ clear: true }); return loadFresh(); }
      deps.apply({ changes: res.changes });
      cursor = res.cursor;
      if (!res.more) return;
    }
  }

  /** Single-flight: a call during a poll joins it. */
  function poll(g: number, k: string): Promise<void> {
    if (!inflight) {
      const p: Promise<void> = runOnce(g, k).finally(() => { if (inflight === p) inflight = null; });
      inflight = p;
    }
    return inflight;
  }

  async function loop(g: number, k: string, baseMs: number, signal: AbortSignal, first: Promise<boolean>) {
    delay = baseMs;
    healthy = await first;
    for (;;) {
      if (g !== gen) return;
      delay = healthy ? baseMs : Math.min(delay * 2, MAX_BACKOFF_MS);
      await deps.sleep(delay, signal);
      if (g !== gen) return;
      if (!deps.isActive()) { healthy = true; continue; }
      healthy = await poll(g, k).then(() => true, () => false);
    }
  }

  function stop(): void {
    gen++;
    abort?.abort();
    abort = null; kehila = null; cursor = null; inflight = null;
  }

  return {
    /** Starts for a Kehila (stopping any previous run); resolves after the first load attempt. */
    start(k: string, pollSeconds: number): Promise<void> {
      stop();
      const g = gen;
      kehila = k; cursor = null;
      abort = new AbortController();
      const first = poll(g, k).then(() => true, () => false);
      void loop(g, k, Math.max(1, pollSeconds) * 1000, abort.signal, first);
      return first.then(() => undefined);
    },
    stop,
    /** Poll now (focus, push). Joins a poll in flight; does nothing when not started. */
    async pollNow(): Promise<void> {
      if (kehila === null) return;
      const g = gen;
      try { await poll(g, kehila); if (g === gen) healthy = true; } catch { /* the loop's own schedule retries */ }
    },
  };
}
