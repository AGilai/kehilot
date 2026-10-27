import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth/AuthProvider.tsx';
import { parseCached, scheduleCacheKey } from '../schedule/cache.ts';
import type { ScheduleDoc } from '../schedule/types.ts';
import { useSession } from './SessionProvider.tsx';

export type ScheduleState =
  | { status: 'loading' }
  | { status: 'ready'; doc: ScheduleDoc; /** Set when the doc is the copy kept on this device (the fetch failed): when it was saved. */ cachedAt: number | null }
  | { status: 'error' };

/** The Kehila's saved schedule (any role): fetched on open, kept on the device for offline use. */
export function useSchedule(): { state: ScheduleState; retry: () => void } {
  const { api } = useAuth();
  const kehilaId = useSession().state.kehilaId;
  const [state, setState] = React.useState<ScheduleState>({ status: 'loading' });
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (!kehilaId) return;
    let live = true;
    setState({ status: 'loading' });
    api.schedule(kehilaId).then(async doc => {
      if (live) setState({ status: 'ready', doc, cachedAt: null });
      await AsyncStorage.setItem(scheduleCacheKey(kehilaId), JSON.stringify({ doc, savedAt: Date.now() })).catch(() => {});
    }, async () => {
      const saved = parseCached(await AsyncStorage.getItem(scheduleCacheKey(kehilaId)).catch(() => null));
      if (live) setState(saved ? { status: 'ready', doc: saved.doc, cachedAt: saved.savedAt } : { status: 'error' });
    });
    return () => { live = false; };
  }, [api, kehilaId, revision]);
  const retry = React.useCallback(() => setRevision(n => n + 1), []);
  return { state, retry };
}
