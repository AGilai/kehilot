import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import type { TreeDoc } from '../client/tree.ts';
import type { FamilyView } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { israelDayMonth, statusLine } from '../tree/labels.ts';
import { familyStatus } from '../tree/layout.ts';

/** The family tree and the §18.2 status line for a member or gabbai (Me card and Kehila menu). Nothing until the tree is here. */
export function useFamilyLine(kehilaId: string | undefined, enabled: boolean): { doc: TreeDoc | null; line: { text: string; tone: 'request' | 'missing' | 'muted' } | null } {
  const { t } = useI18n();
  const { api } = useAuth();
  const [doc, setDoc] = React.useState<TreeDoc | null>(null);
  const [view, setView] = React.useState<FamilyView | null>(null);
  React.useEffect(() => {
    if (!kehilaId || !enabled) { setDoc(null); setView(null); return; }
    let live = true;
    api.family(kehilaId).then(v => { if (live) setView(v); }, () => { if (live) setView(null); });
    api.familyTree(kehilaId).then(d => { if (live) setDoc(d); }, () => { if (live) setDoc(null); });
    return () => { live = false; };
  }, [api, kehilaId, enabled]);
  if (!doc) return { doc: null, line: null };
  const request = view?.received[0];
  const sent = view?.sent?.state === 'pending' ? view.sent : null;
  const line = statusLine(familyStatus({ tree: doc.people, updated: doc.updatedAt ? israelDayMonth(doc.updatedAt) : null, request: request ? { name: request.fromName } : null, sent: sent ? { name: sent.toName } : null }), t);
  return { doc, line };
}
