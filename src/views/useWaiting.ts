import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import type { Api } from '../auth/AuthProvider.tsx';
import { waitingAny } from '../client/adminAreas.ts';
import { createWaitingStore } from '../client/waitingStore.ts';
import type { WaitingCounts } from '../client/waitingStore.ts';
import { useSession } from '../client/SessionProvider.tsx';

/** One store for the whole app: the logo dot (TopBar), the Kehila menu and the management overview read the same numbers. */
let loader: ((kehilaId: string) => Promise<WaitingCounts>) | null = null;
export const waitingStore = createWaitingStore(async kehilaId => {
  if (!loader) throw new Error('no api');
  return loader(kehilaId);
});

async function load(api: Api, kehilaId: string, seats: boolean): Promise<WaitingCounts> {
  const [req, hints, groups, autos] = await Promise.allSettled([api.requests(kehilaId), seats ? api.seatLinkSuggestions(kehilaId) : Promise.resolve({ count: 0 }), api.groups(kehilaId), seats ? api.seatAutoLinks(kehilaId) : Promise.resolve({ count: 0 })]);
  if (req.status === 'rejected' && hints.status === 'rejected' && groups.status === 'rejected') throw new Error('waiting');
  const prev = waitingStore.get();
  return {
    requests: req.status === 'fulfilled' ? req.value.length : prev.requests,
    // automatic links wait for a look (undo for 14 days) next to the suggestions
    linkHints: hints.status === 'fulfilled' ? hints.value.count + (autos.status === 'fulfilled' ? autos.value.count : 0) : prev.linkHints,
    groupRequests: groups.status === 'fulfilled' ? groups.value.reduce((n, g) => n + (g.pendingCount ?? 0), 0) : prev.groupRequests,
  };
}

/**
 * What waits for a gabbai (join requests, unaccepted terms, seat link suggestions, group requests). Fetched once per
 * Kehila and again on `refresh()` (the Kehila menu opening, an approval acted on). Counts are zero for everyone else.
 */
export function useWaiting(): { requests: number; terms: boolean; linkHints: number; groupRequests: number; any: boolean; refresh: () => void; setRequests: (n: number) => void } {
  const { api } = useAuth();
  const { state } = useSession();
  const kehilaId = state.kehilaId;
  const gabbai = state.kehila?.role === 'gabbai';
  loader = id => load(api, id, true);
  const snap = React.useSyncExternalStore(waitingStore.subscribe, waitingStore.get, waitingStore.get);
  const refresh = React.useCallback(() => { if (kehilaId && gabbai) void waitingStore.refresh(kehilaId); }, [kehilaId, gabbai]);
  React.useEffect(refresh, [refresh, state.kehila?.cards.terms]);
  const mine = gabbai && snap.kehilaId === kehilaId;
  const w = { requests: mine ? snap.requests : 0, terms: gabbai && !!state.kehila?.cards.terms, linkHints: mine ? snap.linkHints : 0, groupRequests: mine ? snap.groupRequests : 0 };
  return { ...w, any: waitingAny(state.kehila?.role, w), refresh, setRequests: waitingStore.setRequests };
}
