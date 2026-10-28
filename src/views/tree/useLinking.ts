import React from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { linkChanged, linkModel } from '../../client/linking.ts';
import type { LinkModel } from '../../client/linking.ts';
import type { FamilyView } from '../../client/types.ts';
import { useErrorText } from '../auth/Frame.tsx';

const POLL_MS = 20_000;

export type Linking = {
  view: FamilyView | null;
  model: LinkModel;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  reload: () => Promise<void>;
  /** Runs one family call, then reloads the view. Resolves true when it went through. */
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
};

/**
 * The partner-request state for the tree (the old Me family card's `load` / `run`, shared). Loaded on open, every 20 s while the
 * tree is open and when the app comes back to the front, so a request that arrives meanwhile shows its banner. `onChanged` is
 * called when the adults changed (confirmed or unlinked): the caller reloads the tree.
 * `enabled` false (the gabbai's read-only view) loads nothing.
 */
export function useLinking(api: ReturnType<typeof useAuth>['api'], kehilaId: string | undefined, enabled: boolean, onChanged: () => void): Linking {
  const errText = useErrorText();
  const [view, setView] = React.useState<FamilyView | null>(null);
  const viewRef = React.useRef<FamilyView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const onChangedRef = React.useRef(onChanged);
  onChangedRef.current = onChanged;
  const live = React.useRef(true);
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const reload = React.useCallback(async () => {
    if (!enabled || !kehilaId) return;
    try {
      const next = await api.family(kehilaId);
      if (!live.current) return;
      const before = viewRef.current;
      viewRef.current = next; setView(next);
      if (linkChanged(before, next)) onChangedRef.current();
    } catch { /* a failed background reload keeps what is shown */ }
  }, [api, kehilaId, enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    void reload();
    const timer = setInterval(() => { void reload(); }, POLL_MS);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void reload(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [enabled, reload]);

  const run = React.useCallback(async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setError(null);
    try { await fn(); await reload(); return true; } catch (e) { setError(errText(e)); return false; } finally { if (live.current) setBusy(false); }
  }, [busy, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const model = React.useMemo(() => linkModel(enabled ? view : null), [view, enabled]);
  return { view, model, busy, error, clearError: () => setError(null), reload, run };
}
