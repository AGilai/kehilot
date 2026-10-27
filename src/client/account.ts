import { ApiCodeError } from './errors.ts';
import type { endpoints } from './endpoints.ts';

type Api = Pick<ReturnType<typeof endpoints>, 'deleteMe'>;

/** Waits before retry 1..5 of DELETE /v1/me. */
export const DELETE_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

const RETRYABLE = new Set(['internal', 'network']);

/**
 * Deletes the account. DELETE /v1/me is idempotent (API.md), so 500 `internal` and `network` are retried up to
 * 5 times with 1, 2, 4, 8 and 16 s waits. 204 ends in the same full sign-out as a user sign-out. 409
 * `last_gabbai` stops (the screen explains the hand-over). Any other error, or the last failed retry, is thrown.
 */
export async function deleteAccount(
  api: Api,
  signOut: () => Promise<void>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<'deleted' | 'last_gabbai'> {
  for (let attempt = 0; ; attempt++) {
    try {
      await api.deleteMe();
      await signOut();
      return 'deleted';
    } catch (e) {
      if (e instanceof ApiCodeError) {
        if (e.code === 'last_gabbai') return 'last_gabbai';
        if (RETRYABLE.has(e.code) && attempt < DELETE_BACKOFF_MS.length) { await sleep(DELETE_BACKOFF_MS[attempt]!); continue; }
      }
      throw e;
    }
  }
}
