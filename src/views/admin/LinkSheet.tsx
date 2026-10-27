import React from 'react';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import { linkCandidates } from '../../client/membersView.ts';
import type { AdminFamily, MemberRow } from '../../client/types.ts';
import { config } from '../../config.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, PickList, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { normalize, queryWords } from '../../search/normalize.ts';
import { useAdminErrText } from './shared.tsx';

/** P11 sheet: the first person is fixed, one free member or gabbai is picked, the button names both. */
export function LinkSheet({ person, members, families, kehilaId, onClose, onLinked }: {
  person: MemberRow | null; members: MemberRow[]; families: AdminFamily[]; kehilaId: string; onClose: () => void; onLinked: () => void;
}) {
  const { t } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  const errText = useAdminErrText();
  const fx = config.fixtures && fixtureParams().screen === 'admin-link'; // the frame's typed "אב" with one row chosen
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [taken, setTaken] = React.useState<string[]>([]);
  React.useEffect(() => {
    setError(null); setTaken([]);
    setQuery(fx && person ? 'אב' : ''); setSelected(fx && person ? '01FIXTUREUSER000000000' + '24' : null);
  }, [person?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = queryWords(query);
  const rows = person ? linkCandidates(members, families, person.userId).filter(m => !taken.includes(m.userId) && words.every(w => normalize(m.displayName).includes(w))) : [];
  const chosen = rows.find(m => m.userId === selected) ?? null;

  async function confirm() {
    if (!person || !chosen || busy) return;
    setBusy(true); setError(null);
    try { await api.adminLink(kehilaId, person.userId, chosen.userId); onLinked(); }
    catch (e) {
      if (e instanceof ApiCodeError && e.code === 'partner_taken') { setError(t('admin.link.taken', { name: chosen.displayName })); setTaken(x => [...x, chosen.userId]); setSelected(null); }
      else setError(errText(e));
    } finally { setBusy(false); }
  }

  return (
    <Sheet visible={!!person} title={t('admin.link.title')} onClose={onClose}
      footer={<Button title={t('admin.link.confirm', { a: person?.displayName ?? '', b: chosen?.displayName ?? '' })} onPress={() => void confirm()} busy={busy} disabled={!chosen} />}>
      <Txt bold>{t('admin.link.with', { name: person?.displayName ?? '' })}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      <PickList query={query} onQuery={q => { setQuery(q); setError(null); }} placeholder={t('admin.members.search')}
        rows={rows.map(m => ({ id: m.userId, title: m.displayName }))} selected={selected} onSelect={id => { setSelected(id); setError(null); }}
        empty={t('admin.link.none')} state="ready" disabled={busy}
        hint={<Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{t('admin.link.hint')}</Txt>} />
      <Txt size="small">{t('admin.link.notice')}</Txt>
    </Sheet>
  );
}
