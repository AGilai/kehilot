import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth/AuthProvider.tsx';
import { parseCached, scheduleCacheKey, stateFor } from '../schedule/cache.ts';
import type { ScheduleState } from '../schedule/cache.ts';
import { useSession } from './SessionProvider.tsx';

export type { ScheduleState } from '../schedule/cache.ts';

/** The Kehila's saved schedule (any role): fetched on open, kept on the device for offline use. */
export function useSchedule(): { state: ScheduleState; retry: () => void } {
  const { api } = useAuth();
  const kehilaId = useSession().state.kehilaId;
  const [held, setHeld] = React.useState<{ kehilaId: string | null; state: ScheduleState }>({ kehilaId: null, state: { status: 'loading' } });
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (!kehilaId) return;
    let live = true;
    setHeld({ kehilaId, state: { status: 'loading' } });
    api.schedule(kehilaId).then(async doc => {
      if (live) setHeld({ kehilaId, state: { status: 'ready', doc, cachedAt: null } });
      await AsyncStorage.setItem(scheduleCacheKey(kehilaId), JSON.stringify({ doc, savedAt: Date.now() })).catch(() => {});
    }, async () => {
      const saved = parseCached(await AsyncStorage.getItem(scheduleCacheKey(kehilaId)).catch(() => null));
      if (live) setHeld({ kehilaId, state: saved ? { status: 'ready', doc: saved.doc, cachedAt: saved.savedAt } : { status: 'error' } });
    });
    return () => { live = false; };
  }, [api, kehilaId, revision]);
  const retry = React.useCallback(() => setRevision(n => n + 1), []);
  return { state: stateFor(held, kehilaId ?? null), retry };
}
