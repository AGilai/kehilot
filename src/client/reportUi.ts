import React from 'react';
import { config } from '../config.ts';
import { REPORT_PAD } from './reportContext.ts';

/** What the root-mounted report button needs to know about the app around it. Memory only. */
export type ReportUiState = {
  screen: string;
  hasTabs: boolean;
  kehilaId: string | null;
  kehilaName: string | null;
  modals: number;
  viewer: boolean;
  collapsed: boolean;
};

const initial: ReportUiState = { screen: 'signin', hasTabs: false, kehilaId: null, kehilaName: null, modals: 0, viewer: false, collapsed: false };
let state = initial;
const listeners = new Set<() => void>();

function patch(p: Partial<ReportUiState>) {
  const next = { ...state, ...p };
  if ((Object.keys(next) as Array<keyof ReportUiState>).every(k => next[k] === state[k])) return;
  state = next;
  listeners.forEach(l => l());
}

export const reportUi = {
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  setScreen(p: { screen: string; hasTabs: boolean; kehilaId?: string | null; kehilaName?: string | null }) {
    patch({ screen: p.screen, hasTabs: p.hasTabs, kehilaId: p.kehilaId ?? null, kehilaName: p.kehilaName ?? null });
  },
  setCollapsed: (collapsed: boolean) => patch({ collapsed }),
  setViewer: (viewer: boolean) => patch({ viewer }),
  /** Register one open sheet or modal; call the result to release it (idempotent). */
  modal() {
    patch({ modals: state.modals + 1 });
    let done = false;
    return () => { if (done) return; done = true; patch({ modals: Math.max(0, state.modals - 1) }); };
  },
  reset() { state = initial; listeners.forEach(l => l()); },
};

export const useReportUi = (): ReportUiState => React.useSyncExternalStore(reportUi.subscribe, reportUi.get, reportUi.get);

/** A screen reports where it is; cleared when it unmounts. */
export function useReportScreen(p: { screen: string | null; hasTabs: boolean; kehilaId?: string | null; kehilaName?: string | null }) {
  React.useEffect(() => { if (p.screen) reportUi.setScreen({ ...p, screen: p.screen }); }, [p.screen, p.hasTabs, p.kehilaId, p.kehilaName]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Counts a Sheet/Modal as open while `open`, so the button hides. */
export function useModalOpen(open: boolean) {
  React.useEffect(() => (open ? reportUi.modal() : undefined), [open]);
}

/** Bottom padding for scrolling screens while the report button can show (UX-DESIGN §13.1): 56, else 0. */
export function useReportPad(): number {
  const { screen } = useReportUi();
  return config.bugReports && screen !== 'chat' ? REPORT_PAD : 0;
}
