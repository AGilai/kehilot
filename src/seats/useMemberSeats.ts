import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useSession } from '../client/SessionProvider.tsx';
import { memberFromWire, saveRelease } from './wire.ts';
import type { MemberSeats, SaveResult } from './wire.ts';
import type { Prayer } from './release.ts';

export type MemberSeatsState = { status: 'loading' } | { status: 'error'; code: unknown } | { status: 'ready'; data: MemberSeats };

/** The member's own cut of the week (`GET …/seats/me`), reloadable, with the save that follows the 409 rule. Only his frames ever arrive. */
export function useMemberSeats(enabled = true, week?: string): { state: MemberSeatsState; reload: () => void; save: (choices: Partial<Record<Prayer, ReadonlySet<string>>>) => Promise<SaveResult | null> } {
  const { api } = useAuth();
  const kehilaId = useSession().state.kehilaId;
  const [state, setState] = React.useState<MemberSeatsState>({ status: 'loading' });
  const live = React.useRef(true);
  const current = React.useRef<MemberSeats | null>(null);
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = React.useCallback(async (): Promise<MemberSeats> => {
    const data = memberFromWire(await api.seatsMe(kehilaId!, week));
    current.current = data;
    return data;
  }, [api, kehilaId, week]);

  const reload = React.useCallback(() => {
    if (!enabled || !kehilaId) return;
    setState({ status: 'loading' });
    load().then((data) => { if (live.current) setState({ status: 'ready', data }); }, (code) => { if (live.current) setState({ status: 'error', code }); });
  }, [enabled, kehilaId, load]);
  React.useEffect(() => { reload(); }, [reload]);

  const save = React.useCallback(async (choices: Partial<Record<Prayer, ReadonlySet<string>>>): Promise<SaveResult | null> => {
    let base = current.current;
    if (!base || !kehilaId) return null;
    let result: SaveResult | null = null;
    const deps = { put: async (body: Parameters<typeof api.putSeatsMe>[1]) => memberFromWire(await api.putSeatsMe(kehilaId, body)), reread: load };
    for (const p of ['arvit', 'shacharit'] as Prayer[]) {
      const choice = choices[p];
      if (!choice) continue;
      result = await saveRelease(deps, base, p, choice);
      base = result.data;
      current.current = base;
      if (result.kind === 'updated') break; // his choice for the other prayer is dropped too: he sees the current state first
    }
    if (result && live.current) setState({ status: 'ready', data: result.data });
    return result;
  }, [api, kehilaId, load]);

  return { state, reload, save };
}
