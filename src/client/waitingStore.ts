/**
 * What waits for a gabbai (§18.3 "לטיפול עכשיו"): one shared store for the logo dot, the Kehila menu and the overview.
 * `refresh` shares one in-flight fetch per Kehila; an answer for a Kehila that is no longer current is dropped; a failed
 * load keeps the numbers it had. No React here.
 */
/** `sheetPending`: weekly sheet items waiting for approval (current and next sheet week); `sheetPendingWeek`: the first week that has any (Friday, YYYY-MM-DD). */
export type WaitingCounts = { requests: number; linkHints: number; groupRequests: number; sheetPending: number; sheetPendingWeek: string | null };
export type WaitingSnapshot = WaitingCounts & { kehilaId: string | null };

export function createWaitingStore(load: (kehilaId: string) => Promise<WaitingCounts>) {
  let snap: WaitingSnapshot = { kehilaId: null, requests: 0, linkHints: 0, groupRequests: 0, sheetPending: 0, sheetPendingWeek: null };
  const listeners = new Set<() => void>();
  const flights = new Map<string, Promise<void>>();
  const set = (next: WaitingSnapshot) => {
    if (next.kehilaId === snap.kehilaId && next.requests === snap.requests && next.linkHints === snap.linkHints && next.groupRequests === snap.groupRequests && next.sheetPending === snap.sheetPending && next.sheetPendingWeek === snap.sheetPendingWeek) return;
    snap = next;
    listeners.forEach(l => l());
  };
  return {
    get: (): WaitingSnapshot => snap,
    subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
    /** The approvals screen knows the new count right after an action. */
    setRequests(n: number) { set({ ...snap, requests: n }); },
    /** The sheet screen knows the new count right after an approval. */
    setSheetPending(n: number, week: string | null) { set({ ...snap, sheetPending: n, sheetPendingWeek: week }); },
    refresh(kehilaId: string): Promise<void> {
      if (snap.kehilaId !== kehilaId) set({ kehilaId, requests: 0, linkHints: 0, groupRequests: 0, sheetPending: 0, sheetPendingWeek: null });
      const running = flights.get(kehilaId);
      if (running) return running;
      const p = load(kehilaId).then(c => { if (snap.kehilaId === kehilaId) set({ kehilaId, ...c }); }, () => {}).finally(() => { flights.delete(kehilaId); });
      flights.set(kehilaId, p);
      return p;
    },
  };
}
