import { ApiCodeError } from '../client/errors.ts';
import type { Message } from '../client/types.ts';
import type { CachedMessage } from './cache.ts';

export type Hit = { kind: 'full'; message: Message } | { kind: 'copy'; copy: CachedMessage } | { kind: 'notFound' };

/**
 * What the detail screen shows for a message that is not in the feed (a search hit). Online: the full
 * message from the API, so replies, join, reply box, delete and image all work. Without a connection (or on
 * a server error): the read-only cached copy. 404: not found, and the id is dropped from the cache.
 */
export async function resolveHit(id: string, d: {
  fetch: () => Promise<Message>;
  cached: () => Promise<CachedMessage | null>;
  forget: (id: string) => Promise<void>;
}): Promise<Hit> {
  try {
    return { kind: 'full', message: await d.fetch() };
  } catch (e) {
    if (e instanceof ApiCodeError && e.status === 404) {
      try { await d.forget(id); } catch { /* the cache is only a convenience */ }
      return { kind: 'notFound' };
    }
  }
  const copy = await d.cached();
  return copy ? { kind: 'copy', copy } : { kind: 'notFound' };
}
