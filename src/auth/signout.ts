export type SignOutDeps = {
  deleteDevice: (token: string) => Promise<void>;
  revoke: (refreshToken: string) => Promise<void>;
  clear: () => Promise<void>;
  /** Drops the pending invite code (kehilot.pendingInvite) so the next account cannot accept it. */
  clearPending?: () => Promise<void>;
  /** Task 9 session store reset. */
  reset: () => void;
  /** Sets the UI status to signedOut. */
  done: () => void;
};

/** Every sign-out path ends here: tokens cleared (errors ignored), session store reset, status signedOut. */
export async function localSignOut(d: Pick<SignOutDeps, 'clear' | 'clearPending' | 'reset' | 'done'>): Promise<void> {
  try {
    try { await d.clear(); } catch { /* storage failure must not block the sign-out */ }
    try { await d.clearPending?.(); } catch { /* ditto */ }
  } finally { d.reset(); d.done(); }
}

/** User-initiated sign-out: device, revoke (both best effort), then the local cleanup. */
export async function signOutSequence(d: SignOutDeps, pushToken: string | null, refreshToken: string | null): Promise<void> {
  try {
    if (pushToken) { try { await d.deleteDevice(pushToken); } catch { /* ignore */ } }
    if (refreshToken) { try { await d.revoke(refreshToken); } catch { /* ignore */ } }
  } finally {
    await localSignOut(d);
  }
}

/** Start-up: a network failure keeps the stored session ('offline'); only a real sign-out gives 'signedOut'. */
export async function resolveStart(restore: () => Promise<boolean>): Promise<'signedIn' | 'signedOut' | 'offline'> {
  try { return (await restore()) ? 'signedIn' : 'signedOut'; } catch { return 'offline'; }
}
