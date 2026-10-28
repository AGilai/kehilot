import { familyState } from './familyView.ts';
import type { FamilyView } from './types.ts';

/** What the empty spouse place in the tree shows (UX-DESIGN §18.2): empty ("+"), or the requested member's name with "ממתין לאישור". */
export type SpouseSlot = { kind: 'empty' } | { kind: 'pending'; name: string; expiresAt: number };

/** The banner under the tree's title: a request I received (confirm / decline), or mine that was not confirmed / expired (dismiss). */
export type LinkBanner =
  | { kind: 'received'; fromUserId: string; name: string }
  | { kind: 'declined' | 'expired'; name: string };

export type LinkModel = {
  slot: SpouseSlot;
  banner: LinkBanner | null;
  /** The linked partner's account name (the unlink confirm), or null when not linked. */
  linkedName: string | null;
  /** The empty place opens the member picker / the request sheet; false when linked (nothing to ask). */
  canRequest: boolean;
};

/**
 * Request state → what the tree shows. Same priority as the old family card (`familyState`): linked, received, sent, declined,
 * expired. Before the family loads (or for the gabbai's read-only view, which never loads it) nothing is shown.
 */
export function linkModel(view: FamilyView | null): LinkModel {
  if (!view) return { slot: { kind: 'empty' }, banner: null, linkedName: null, canRequest: false };
  const st = familyState(view);
  const sent = view.sent;
  const received = view.received[0];
  return {
    slot: st === 'sent' && sent ? { kind: 'pending', name: sent.toName, expiresAt: sent.expiresAt } : { kind: 'empty' },
    banner: st === 'received' && received ? { kind: 'received', fromUserId: received.fromUserId, name: received.fromName }
      : (st === 'declined' || st === 'expired') && sent ? { kind: st, name: sent.toName } : null,
    linkedName: st === 'linked' ? view.adults.find(a => !a.me)?.displayName ?? null : null,
    canRequest: st !== 'linked',
  };
}

/** True when the view differs in a way the tree must reload for (a request was confirmed or the link was cancelled). */
export const linkChanged = (before: FamilyView | null, after: FamilyView): boolean =>
  !!before && (before.adults.length !== after.adults.length || before.adults.some((a, i) => a.userId !== after.adults[i]?.userId));
