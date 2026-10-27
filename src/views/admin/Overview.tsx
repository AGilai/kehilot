import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { InviteRow } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { LinkShare } from '../Me.tsx';
import { PrivacyContactCard, TermsCard } from './PrivacyContactCard.tsx';
import { useShortDate, useAdminErrText } from './shared.tsx';

type Counts = { pending: number; members: number; listeners: number };

/** The listener cap with an edit (PUT settings, 0 to 5000). */
function CapCard({ cap, listeners, onSaved }: { cap: number | undefined; listeners: number | undefined; onSaved: (n: number) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const n = /^\d+$/.test(text.trim()) && +text <= 5000 ? +text : null;
  async function save() {
    if (n === null || busy || !state.kehilaId) return;
    setBusy(true); setError(null);
    try { await api.putSettings(state.kehilaId, { maxListeners: n }); onSaved(n); setEditing(false); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('admin.overview.cap.title')}</Txt>
      <Txt size="small" color={k.muted}>{t('admin.overview.cap.body')}</Txt>
      {cap !== undefined ? <Txt bold>{t('admin.overview.cap.value', { n: listeners ?? 0, max: cap })}</Txt> : null}
      {editing ? (
        <>
          <Field label={t('admin.overview.cap.field')} value={text} onChangeText={setText} keyboardType="number-pad" error={n === null ? t('admin.overview.cap.invalid') : null} />
          {error ? <Banner tone="error" text={error} /> : null}
          <Button title={t('admin.overview.cap.save')} onPress={() => void save()} busy={busy} disabled={n === null} />
          <Button kind="secondary" title={t('common.cancel')} onPress={() => { setEditing(false); setError(null); }} disabled={busy} />
        </>
      ) : <Button kind="secondary" title={t('admin.overview.cap.edit')} onPress={() => { setText(String(cap ?? 0)); setEditing(true); }} />}
    </Card>
  );
}

/** Every unexpired invite of the Kehila (a gabbai sees all), with share and revoke. */
function InviteList({ rows, onChanged, onToast }: { rows: InviteRow[]; onChanged: () => Promise<void>; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const date = useShortDate();
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function revoke(code: string) {
    if (!state.kehilaId) return;
    setBusy(true); setError(null);
    try { await api.revokeInvite(state.kehilaId, code); onToast(t('me.links.revoked')); setAsking(null); await onChanged(); }
    catch (e) {
      if (e instanceof ApiCodeError && e.code === 'invite_not_found') { setAsking(null); await onChanged(); } else setError(errText(e));
    } finally { setBusy(false); }
  }
  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('admin.overview.invites.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {rows.length === 0 ? <Txt color={k.muted}>{t('admin.overview.invites.empty')}</Txt> : null}
      {rows.map(r => (
        <View key={r.code} style={{ gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: k.line }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Tag label={t(`admin.overview.invites.role.${r.role}`)} tone="strong" />
            <Tag label={r.mine ? t('admin.overview.invites.mine') : t('admin.overview.invites.other')} />
          </View>
          <Txt>{t('me.links.usesLeft', { n: r.usesLeft })}</Txt>
          <Txt size="small" color={k.muted}>{t('me.links.expires', { date: date(r.expiresAt) })}</Txt>
          <LinkShare code={r.code} onToast={onToast} />
          {asking === r.code ? (
            <View style={{ gap: 8 }}>
              <Txt size="small">{t('me.links.revokeConfirm')}</Txt>
              <Button kind="danger" title={t('me.links.revokeYes')} onPress={() => void revoke(r.code)} busy={busy} />
              <Button kind="secondary" title={t('me.links.keep')} onPress={() => setAsking(null)} disabled={busy} />
            </View>
          ) : <Button kind="secondary" title={t('me.links.revoke')} onPress={() => setAsking(r.code)} />}
        </View>
      ))}
    </Card>
  );
}

/** GM1 without the seating meters: pending count, member and listener counts, the cap, the invite links. */
export function Overview({ onApprovals, onInvite, onGroups, onChannels, onImport, onPushTexts, onSeatPrint, onSchedule, onSeatEditor, onCount, onToast }: { onApprovals: () => void; onInvite: () => void; onGroups: () => void; onChannels: () => void; onImport: () => void; onPushTexts: () => void; /** The seat-release preview (UX §15.5): only passed when the preview flag is on. */ onSeatPrint?: () => void; /** The prayer-schedule editor (UX §14.2). */ onSchedule?: () => void; /** The seating editor (UX §16): gabbaim only. */ onSeatEditor?: () => void; onCount: (n: number) => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state, refreshKehila } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [counts, setCounts] = React.useState<Counts | null>(null);
  const [cap, setCap] = React.useState<{ max?: number; listeners?: number } | null>(null);
  const [privacy, setPrivacy] = React.useState<{ contact: string; terms: { name: string; at: number } | null | undefined } | null>(null);
  const [invites, setInvites] = React.useState<InviteRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadInvites = React.useCallback(async () => {
    try { setInvites(await api.invites(kehilaId)); } catch (e) { setError(errText(e)); setInvites(prev => prev ?? []); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = React.useCallback(async () => {
    const [req, mem, keh] = await Promise.allSettled([api.requests(kehilaId), api.members(kehilaId), api.kehila(kehilaId)]);
    const failed = [req, mem, keh].find(x => x.status === 'rejected');
    setError(failed && failed.status === 'rejected' ? errText(failed.reason) : null);
    if (req.status === 'fulfilled') onCount(req.value.length);
    setCounts(prev => ({
      pending: req.status === 'fulfilled' ? req.value.length : prev?.pending ?? 0,
      members: mem.status === 'fulfilled' ? mem.value.filter(m => m.role !== 'listener').length : prev?.members ?? 0,
      listeners: mem.status === 'fulfilled' ? mem.value.filter(m => m.role === 'listener').length : prev?.listeners ?? 0,
    }));
    if (keh.status === 'fulfilled') {
      setCap({ max: keh.value.settings.maxListeners, listeners: keh.value.listenerCount });
      setPrivacy({ contact: keh.value.privacyContact ?? '', terms: keh.value.termsAccepted });
    }
    await loadInvites();
  }, [api, kehilaId, loadInvites]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <Txt serif size="title" accessibilityRole="header">{t('admin.overview.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {!counts ? <ActivityIndicator color={k.tekhelet} /> : null}
      {counts ? (
        <>
          <Card>
            <Txt bold size="heading">{counts.pending > 0 ? t('admin.overview.pending', { n: counts.pending }) : t('admin.overview.pendingNone')}</Txt>
            {counts.pending > 0 ? <Button title={t('admin.overview.review')} onPress={onApprovals} /> : null}
          </Card>
          {onSchedule ? (
            <Card>
              <Txt serif size="heading" accessibilityRole="header">{t('editor.card.title')}</Txt>
              <Txt size="small" color={k.muted}>{t('editor.card.body')}</Txt>
              <Button title={t('editor.card.open')} onPress={onSchedule} />
            </Card>
          ) : null}
          {onSeatEditor ? (
            <Card>
              <Txt serif size="heading" accessibilityRole="header">{t('seatEditor.card.title')}</Txt>
              <Txt size="small" color={k.muted}>{t('seatEditor.card.body')}</Txt>
              <Button title={t('seatEditor.card.open')} onPress={onSeatEditor} />
            </Card>
          ) : null}
          {privacy ? <PrivacyContactCard contact={privacy.contact} onSaved={c => { setPrivacy(p => p && { ...p, contact: c }); onToast(t('admin.overview.privacy.saved')); void refreshKehila(); }} /> : null}
          {privacy ? <TermsCard accepted={privacy.terms} /> : null}
          <Card>
            <Txt serif size="heading" accessibilityRole="header">{t('admin.overview.counts')}</Txt>
            <Txt>{t('admin.overview.members', { n: counts.members })}</Txt>
            <Txt>{t('admin.overview.listeners', { n: counts.listeners })}</Txt>
          </Card>
          <CapCard cap={cap?.max} listeners={cap?.listeners ?? counts.listeners} onSaved={n => { setCap(c => ({ ...c, max: n })); onToast(t('admin.overview.cap.saved')); }} />
        </>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 140 }}><Button kind="secondary" title={t('admin.overview.groupsLink')} onPress={onGroups} /></View>
        <View style={{ flex: 1, minWidth: 140 }}><Button kind="secondary" title={t('admin.overview.channelsLink')} onPress={onChannels} /></View>
      </View>
      <Button kind="secondary" title={t('admin.overview.importLink')} onPress={onImport} />
      <Button kind="secondary" title={t('admin.overview.pushTextsLink')} onPress={onPushTexts} />
      {onSeatPrint ? <Button kind="secondary" title={t('seats.print.link')} onPress={onSeatPrint} /> : null}
      <Button title={t('admin.overview.invites.new')} onPress={onInvite} />
      {invites ? <InviteList rows={invites} onChanged={loadInvites} onToast={onToast} /> : null}
    </PadScroll>
  );
}
