export type LocalSignOutDeps = {
  clearTokens: () => Promise<void>;
  /** Drops the pending invite code (kehilot.pendingInvite) so the next account cannot accept it. */
  clearPending?: () => Promise<void>;
  /** The on-phone message cache, the image cache and the share files (Task 12b). */
  wipeCaches: () => Promise<void>;
  /** Session store reset. */
  resetStore: () => void;
  /** Sets the UI status to signedOut. */
  done?: () => void;
};
export type SignOutDeps = LocalSignOutDeps & {
  deleteDevice: () => Promise<void>;
  revoke: () => Promise<void>;
};

/**
 * Every sign-out path ends here (user, forced, account deleted): tokens, pending invite and caches are
 * cleared (each step's error ignored, so one failure never skips the next), then the session store is
 * reset and the status becomes signedOut.
 */
export async function localSignOut(d: LocalSignOutDeps): Promise<void> {
  try {
    for (const step of [d.clearTokens, d.clearPending, d.wipeCaches]) {
      try { await step?.(); } catch { /* storage failure must not block the sign-out */ }
    }
  } finally { d.resetStore(); d.done?.(); }
}

/** User-initiated sign-out: device and revoke first (best effort), then the local clean-up. */
export function createSignOut(d: SignOutDeps): () => Promise<void> {
  return async () => {
    try {
      try { await d.deleteDevice(); } catch { /* ignore */ }
      try { await d.revoke(); } catch { /* ignore */ }
    } finally {
      await localSignOut(d);
    }
  };
}

/** Start-up: a network failure keeps the stored session ('offline'); only a real sign-out gives 'signedOut'. */
export async function resolveStart(restore: () => Promise<boolean>): Promise<'signedIn' | 'signedOut' | 'offline'> {
  try { return (await restore()) ? 'signedIn' : 'signedOut'; } catch { return 'offline'; }
}
