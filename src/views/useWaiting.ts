import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import type { Api } from '../auth/AuthProvider.tsx';
import { sheetPendingOf } from '../client/sheetItems.ts';
import { waitingAny } from '../client/adminAreas.ts';
import { createWaitingStore } from '../client/waitingStore.ts';
import type { WaitingCounts } from '../client/waitingStore.ts';
import { scheduleWeekOf, addDays } from '../schedule/week.ts';
import { israelDate } from '../dates.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { isManagement } from '../client/roles.ts';

/** One store for the whole app: the logo dot (TopBar), the Kehila menu and the management overview read the same numbers. */
let loader: ((kehilaId: string) => Promise<WaitingCounts>) | null = null;
export const waitingStore = createWaitingStore(async kehilaId => {
  if (!loader) throw new Error('no api');
  return loader(kehilaId);
});

async function load(api: Api, kehilaId: string, seats: boolean): Promise<WaitingCounts> {
  const friday = scheduleWeekOf(israelDate()).friday;
  const weeks = [friday, addDays(friday, 7)];
  const [req, hints, groups, autos, sheet0, sheet1] = await Promise.allSettled([api.requests(kehilaId), seats ? api.seatLinkSuggestions(kehilaId) : Promise.resolve({ count: 0 }), api.groups(kehilaId), seats ? api.seatAutoLinks(kehilaId) : Promise.resolve({ count: 0 }), api.sheetItems(kehilaId, weeks[0]!), api.sheetItems(kehilaId, weeks[1]!)]);
  if (req.status === 'rejected' && hints.status === 'rejected' && groups.status === 'rejected' && sheet0.status === 'rejected' && sheet1.status === 'rejected') throw new Error('waiting');
  const prev = waitingStore.get();
  // A failed week keeps the previous numbers for both (a half answer would show a wrong total).
  const sheet = sheetPendingOf(weeks, [sheet0, sheet1].map(r => (r.status === 'fulfilled' ? r.value : null)), { n: prev.sheetPending, week: prev.sheetPendingWeek });
  const sheetPending = sheet.n, sheetPendingWeek = sheet.week;
  return {
    sheetPending, sheetPendingWeek,
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
export function useWaiting(): { requests: number; terms: boolean; linkHints: number; groupRequests: number; sheetPending: number; sheetPendingWeek: string | null; any: boolean; refresh: () => void; setRequests: (n: number) => void; setSheetPending: (n: number, week: string | null) => void } {
  const { api } = useAuth();
  const { state } = useSession();
  const kehilaId = state.kehilaId;
  const gabbai = isManagement(state.kehila?.role);
  loader = id => load(api, id, true);
  const snap = React.useSyncExternalStore(waitingStore.subscribe, waitingStore.get, waitingStore.get);
  const refresh = React.useCallback(() => { if (kehilaId && gabbai) void waitingStore.refresh(kehilaId); }, [kehilaId, gabbai]);
  React.useEffect(refresh, [refresh, state.kehila?.cards.terms]);
  const mine = gabbai && snap.kehilaId === kehilaId;
  const w = { requests: mine ? snap.requests : 0, terms: gabbai && !!state.kehila?.cards.terms, linkHints: mine ? snap.linkHints : 0, groupRequests: mine ? snap.groupRequests : 0, sheetPending: mine ? snap.sheetPending : 0 };
  return { ...w, sheetPendingWeek: mine ? snap.sheetPendingWeek : null, any: waitingAny(state.kehila?.role, w), refresh, setRequests: waitingStore.setRequests, setSheetPending: waitingStore.setSheetPending };
}
