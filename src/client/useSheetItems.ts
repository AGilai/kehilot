import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useSession } from './SessionProvider.tsx';
import type { SheetPage } from './types.ts';

export type SheetItemsState = {
  page: SheetPage | null;
  status: 'loading' | 'ready' | 'error';
  reload(): Promise<void>;
  /** Replace the page with what a write answered (a move returns the whole page). */
  setPage(page: SheetPage): void;
};

/** The week's sheet items (`GET /sheet/{week}`, week = its Friday): one list for the print, the PDF, Home and the management screen. `null` = no week yet. */
export function useSheetItems(week: string | null): SheetItemsState {
  const { api } = useAuth();
  const kehilaId = useSession().state.kehilaId;
  const key = kehilaId && week ? `${kehilaId}/${week}` : null;
  const [held, setHeld] = React.useState<{ key: string | null; page: SheetPage | null; status: SheetItemsState['status'] }>({ key: null, page: null, status: 'loading' });
  const latest = React.useRef(key);
  latest.current = key;

  const load = React.useCallback(async (): Promise<void> => {
    if (!kehilaId || !week) return;
    const mine = `${kehilaId}/${week}`;
    try {
      const page = await api.sheetItems(kehilaId, week);
      if (latest.current === mine) setHeld({ key: mine, page, status: 'ready' });
    } catch {
      if (latest.current === mine) setHeld(h => ({ key: mine, page: h.key === mine ? h.page : null, status: 'error' }));
    }
  }, [api, kehilaId, week]);

  React.useEffect(() => {
    if (!key) { setHeld({ key: null, page: null, status: 'loading' }); return; }
    setHeld(h => (h.key === key ? h : { key, page: null, status: 'loading' }));
    void load();
  }, [key, load]);

  const setPage = React.useCallback((page: SheetPage) => { if (latest.current) setHeld({ key: latest.current, page, status: 'ready' }); }, []);
  // What was loaded for another week or Kehila never shows as this one's.
  const mine = held.key === key && key !== null;
  return { page: mine ? held.page : null, status: mine ? held.status : 'loading', reload: load, setPage };
}
