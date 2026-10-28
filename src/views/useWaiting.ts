import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useSession } from '../client/SessionProvider.tsx';

/** What waits for a gabbai (join requests, unaccepted terms): the count on the Kehila menu's manage row and the logo dot. */
export function useWaiting(): { requests: number; terms: boolean; any: boolean } {
  const { api } = useAuth();
  const { state } = useSession();
  const kehilaId = state.kehilaId;
  const gabbai = state.kehila?.role === 'gabbai';
  const [requests, setRequests] = React.useState(0);
  React.useEffect(() => {
    if (!kehilaId || !gabbai) { setRequests(0); return; }
    let live = true;
    api.requests(kehilaId).then(r => { if (live) setRequests(r.length); }, () => {});
    return () => { live = false; };
  }, [api, kehilaId, gabbai, state.kehila?.cards.terms]);
  const terms = gabbai && !!state.kehila?.cards.terms;
  return { requests: gabbai ? requests : 0, terms, any: gabbai && (requests > 0 || terms) };
}
