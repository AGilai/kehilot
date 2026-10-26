import type { Message } from '../client/types.ts';
import type { MessageCache } from './cache.ts';

export const PAGE = 50;
export const PAGE_PAUSE_MS = 250;
const INACTIVE_POLL_MS = 1000;

export type BackfillDeps = {
  api: { messages(k: string, o: { before?: string; limit?: number }): Promise<Message[]> };
  cache: Pick<MessageCache, 'upsert' | 'backfillState' | 'saveBackfill'>;
  k: string;
  isActive(): boolean;
  sleep(ms: number): Promise<void>;
  /** False once the Kehila changed, the user signed out or a newer run took over. */
  guard(): boolean;
};

/**
 * Pages through the whole history once (50 per page, newest first). The cursor is saved after every page,
 * so a restart resumes. Waits between pages, pauses while the app is in the background. A failed request
 * throws; the next run continues from the saved cursor.
 */
export async function runBackfill(d: BackfillDeps): Promise<void> {
  for (;;) {
    while (!d.isActive()) {
      if (!d.guard()) return;
      await d.sleep(INACTIVE_POLL_MS);
    }
    if (!d.guard()) return;
    const state = await d.cache.backfillState();
    if (state.complete) return;
    const page = await d.api.messages(d.k, state.before ? { before: state.before, limit: PAGE } : { limit: PAGE });
    if (!d.guard()) return;
    await d.cache.upsert(page, state.wipeGen);
    const oldest = page.reduce<string | null>((o, m) => (o === null || m.messageId < o ? m.messageId : o), state.before);
    const complete = page.length < PAGE;
    if (!d.guard()) return;
    await d.cache.saveBackfill({ before: oldest, complete, wipeGen: state.wipeGen });
    if (complete) return;
    await d.sleep(PAGE_PAUSE_MS);
    if (!d.guard()) return;
  }
}
