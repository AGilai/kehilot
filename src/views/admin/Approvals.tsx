import React from 'react';
import { ActivityIndicator, ScrollView, View, useWindowDimensions } from 'react-native';
import { keyedFlight } from '../../client/singleFlight.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Classification, RequestRow } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../../kit/components.tsx';
import { Choice, Tag, WIDE, useShortDate, useAdminErrText } from './shared.tsx';

type Pick = Classification | 'guest' | null;

/** One request: the person, and the three-way choice with the consequence written under each option. */
function RequestCard({ row, busy, onApprove, onKeep }: { row: RequestRow; busy: boolean; onApprove: (c: Classification) => void; onKeep: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const date = useShortDate();
  const [pick, setPick] = React.useState<Pick>(null);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Txt bold size="heading" style={{ flexShrink: 1 }}>{row.displayName}</Txt>
        {row.previouslyRejected ? <Tag label={t('admin.approvals.previouslyRejected')} tone="strong" /> : null}
      </View>
      <Txt size="small" color={k.muted}>{t('admin.approvals.since', { date: date(row.createdAt) })}</Txt>
      <Txt size="small" bold>{t('admin.approvals.choose')}</Txt>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        <Choice label={t('admin.approvals.optA')} note={t('admin.approvals.noteA')} selected={pick === 'א'} onPress={() => setPick('א')} />
        <Choice label={t('admin.approvals.optKavua')} note={t('admin.approvals.noteKavua')} selected={pick === 'קבוע'} onPress={() => setPick('קבוע')} />
        <Choice label={t('admin.approvals.optGuest')} note={t('admin.approvals.noteGuest')} selected={pick === 'guest'} onPress={() => setPick('guest')} />
      </View>
      {pick === null ? <Txt size="small" color={k.muted}>{t('admin.approvals.pick')}</Txt> : null}
      <Button title={pick === 'guest' ? t('admin.approvals.keepGuest') : t('admin.approvals.approve')} busy={busy} disabled={pick === null}
        kind={pick === 'guest' ? 'secondary' : 'primary'}
        onPress={() => { if (pick === 'guest') onKeep(); else if (pick) onApprove(pick); }} />
    </Card>
  );
}

/** GM2 (cards) and GD2 (queue on the start side, detail beside it): the requests of listeners, oldest first. */
export function Approvals({ onCount, onToast }: { onCount: (n: number) => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const { width } = useWindowDimensions();
  const kehilaId = state.kehilaId!;
  const [rows, setRows] = React.useState<RequestRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const flight = React.useRef(keyedFlight()).current;

  const load = React.useCallback(async () => {
    try { const r = await api.requests(kehilaId); setRows(r); onCount(r.length); setError(null); }
    catch (e) { setError(errText(e)); setRows(prev => prev ?? []); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);

  async function act(u: string, run: () => Promise<unknown>, done: string) {
    await flight(u, async () => {
      setBusy(u); setError(null);
      try { await run(); onToast(done); setSelected(null); await load(); }
      catch (e) {
        // Handled elsewhere, or no longer a listener: the list is simply refreshed.
        if (e instanceof ApiCodeError && (e.code === 'request_not_found' || e.code === 'not_a_listener')) { onToast(t('admin.approvals.refreshed')); setSelected(null); await load(); }
        else setError(errText(e));
      } finally { setBusy(null); }
    });
  }
  const approve = (u: string, c: Classification) => act(u, () => api.approve(kehilaId, u, c), t('admin.approvals.approved'));
  const keep = (u: string) => act(u, () => api.reject(kehilaId, u), t('admin.approvals.kept'));

  const wide = width >= WIDE;
  const list = rows ?? [];
  const current = list.find(r => r.userId === selected) ?? list[0];
  const card = (r: RequestRow) => <RequestCard key={r.userId} row={r} busy={busy === r.userId} onApprove={c => void approve(r.userId, c)} onKeep={() => void keep(r.userId)} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: wide ? 1100 : 680, alignSelf: 'center' }}>
      <Txt serif size="title" accessibilityRole="header">{t('admin.approvals.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {rows === null ? <ActivityIndicator color={k.tekhelet} /> : null}
      {rows && list.length === 0 && !error ? <Txt color={k.muted}>{t('admin.approvals.empty')}</Txt> : null}
      {wide && current ? (
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
          <View style={{ width: 300, gap: 8 }}>
            <Txt size="small" bold color={k.muted}>{t('admin.approvals.queue', { n: list.length })}</Txt>
            {list.map(r => (
              <Button key={r.userId} kind={r.userId === current.userId ? 'primary' : 'secondary'} title={r.previouslyRejected ? `${r.displayName} · ${t('admin.approvals.previouslyRejected')}` : r.displayName} onPress={() => setSelected(r.userId)} />
            ))}
          </View>
          <View style={{ flex: 1 }}>{card(current)}</View>
        </View>
      ) : list.map(card)}
    </ScrollView>
  );
}
