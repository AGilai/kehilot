import React from 'react';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import { config } from '../../config.ts';
import type { Candidate } from '../../client/types.ts';
import { fromEpochSeconds } from '../../client/time.ts';
import { dualDateAt } from '../../dates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, PickList, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { normalize, queryWords } from '../../search/normalize.ts';
import { useErrorText } from '../auth/Frame.tsx';

export function useShortDate() {
  const { lang } = useI18n();
  return (seconds: number) => dualDateAt(fromEpochSeconds(seconds).getTime(), lang);
}

/** P2 picker: members and gabbaim of this Kehila with no partner; one choice, then "send request". */
export function PartnerPicker({ visible, kehilaId, kehilaName, onClose, onSent }: { visible: boolean; kehilaId: string; kehilaName: string; onClose: () => void; onSent: () => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  const errText = useErrorText();
  const shortDate = useShortDate();
  const fx = config.fixtures && fixtureParams().screen === 'partner-picker'; // the frame's typed "יו" with one row chosen
  const [rows, setRows] = React.useState<Candidate[]>([]);
  const [state, setState] = React.useState<'loading' | 'error' | 'ready'>('loading');
  const [query, setQuery] = React.useState(fx ? 'יו' : '');
  const [selected, setSelected] = React.useState<string | null>(fx ? '01FIXTUREUSER00000000005' : null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState('loading');
    try { setRows(await api.familyCandidates(kehilaId)); setState('ready'); } catch { setState('error'); }
  }, [api, kehilaId]);
  React.useEffect(() => { if (visible) { setError(null); setQuery(fx ? 'יו' : ''); setSelected(fx ? '01FIXTUREUSER00000000005' : null); void load(); } }, [visible, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const cooldownText = (c: Candidate) => c.cooldownUntil ? t('family.pick.cooldown', { name: c.displayName, date: shortDate(c.cooldownUntil) }) : null;
  const words = queryWords(query);
  const shown = rows.filter(c => { const hay = normalize(c.displayName); return words.every(w => hay.includes(w)); });
  const chosen = rows.find(c => c.userId === selected) ?? null;
  const blocked = !!chosen && !!cooldownText(chosen);

  async function send() {
    if (!chosen || blocked || busy) return;
    setBusy(true); setError(null);
    try {
      await api.requestPartner(kehilaId, chosen.userId);
      onSent();
    } catch (e) {
      const code = e instanceof ApiCodeError ? e.code : '';
      if (code === 'partner_taken') { setError(t('family.pick.taken', { name: chosen.displayName })); setRows(r => r.filter(c => c.userId !== chosen.userId)); setSelected(null); }
      else if (code === 'request_cooldown') setError(cooldownText(chosen) ?? errText(e));
      else setError(errText(e));
    } finally { setBusy(false); }
  }

  return (
    <Sheet visible={visible} title={t('family.pick.title')} onClose={onClose}
      footer={<Button title={t('family.pick.send')} onPress={() => void send()} busy={busy} disabled={!chosen || blocked} />}>
      <Txt size="small">{t('family.pick.body')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      <PickList query={query} onQuery={q => { setQuery(q); setError(null); }} placeholder={t('family.pick.search')}
        rows={shown.map(c => ({ id: c.userId, title: c.displayName, subtitle: cooldownText(c) ?? undefined }))}
        selected={selected} onSelect={id => { setSelected(id); setError(null); }} empty={t('family.pick.none')}
        hint={<Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{t('family.pick.hint', { kehila: kehilaName })}</Txt>} state={state} errorText={t('errors.network')} disabled={busy} />
      {state === 'error' ? <Button kind="secondary" title={t('common.retry')} onPress={() => void load()} /> : null}
    </Sheet>
  );
}
