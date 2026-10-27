import type { KeyValue } from '../auth/tokens.ts';
import { lastKehilaKey } from './store.ts';
import { logoKey } from './logoCache.ts';

/** Sign-out: forget the signing-out user's last Kehila and every cached Kehila logo (each step's error ignored). */
export async function clearSessionKeys(storage: KeyValue, userId: string | null, listKeys: () => Promise<readonly string[]>): Promise<void> {
  if (userId) { try { await storage.remove(lastKehilaKey(userId)); } catch { /* best effort */ } }
  let keys: readonly string[] = [];
  try { keys = await listKeys(); } catch { /* nothing to list */ }
  const prefix = logoKey('');
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    try { await storage.remove(key); } catch { /* best effort */ }
  }
}
