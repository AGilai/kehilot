import { ApiCodeError } from './errors.ts';
import type { endpoints } from './endpoints.ts';

type Api = Pick<ReturnType<typeof endpoints>, 'deleteMe'>;

/** Waits before retry 1..5 of DELETE /v1/me. */
export const DELETE_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

const RETRYABLE = new Set(['internal', 'network', 'try_again']);

/**
 * Deletes the account. DELETE /v1/me is idempotent (API.md), so 500 `internal`, 503 `try_again` (the server ran out of time; a retry finishes the job) and `network` are retried up to
 * 5 times with 1, 2, 4, 8 and 16 s waits. 204 (or 401 `account_deleted`) ends in the same full sign-out as a user sign-out, run once. 409
 * `last_gabbai` stops (the screen explains the hand-over). Any other error, or the last failed retry, is thrown.
 */
export async function deleteAccount(
  api: Api,
  signOut: () => Promise<void>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  o: { deletePosts?: boolean } = {},
): Promise<'deleted' | 'last_gabbai'> {
  const deletePosts = !!o.deletePosts; // the same choice on every retry
  for (let attempt = 0; ; attempt++) {
    try {
      await api.deleteMe({ deletePosts });
      break;
    } catch (e) {
      if (e instanceof ApiCodeError) {
        // The account is already gone (a lost response, then the tombstone answers 401): that is success.
        if (e.code === 'account_deleted') break;
        if (e.code === 'last_gabbai') return 'last_gabbai';
        if (RETRYABLE.has(e.code) && attempt < DELETE_BACKOFF_MS.length) { await sleep(DELETE_BACKOFF_MS[attempt]!); continue; }
      }
      throw e;
    }
  }
  // The account is deleted. A failing local clean-up must not be reported as a failed deletion.
  try { await signOut(); } catch { /* the forced sign-out (account_deleted) or the next start finishes it */ }
  return 'deleted';
}
