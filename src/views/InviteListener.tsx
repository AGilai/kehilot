import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { ApiCodeError } from '../client/errors.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { fromEpochSeconds } from '../client/time.ts';
import { dualDateAt } from '../dates.ts';
import type { InviteRow } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { BackLink, LinkShare } from './Me.tsx';
import { useErrorText } from './auth/Frame.tsx';

/** "הקישורים שלי": the caller's own unexpired listener links, with copy/share and revoke (confirmed). */
function MyLinks({ kehilaId, version, onToast }: { kehilaId: string; version: number; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  const errText = useErrorText();
  const [rows, setRows] = React.useState<InviteRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const all = await api.invites(kehilaId);
      setRows(all.filter(r => r.mine && r.role === 'listener' && r.usesLeft > 0));
      setError(null);
    } catch (e) { setError(errText(e)); setRows(prev => prev ?? []); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load, version]);

  async function revoke(code: string) {
    setBusy(true);
    try { await api.revokeInvite(kehilaId, code); setAsking(null); onToast(t('me.links.revoked')); await load(); }
    catch (e) {
      // Already gone (expired, or removed on another device): the list is simply refreshed.
      if (e instanceof ApiCodeError && e.code === 'invite_not_found') { setAsking(null); await load(); } else setError(errText(e));
    } finally { setBusy(false); }
  }
  const date = (seconds: number) => dualDateAt(fromEpochSeconds(seconds).getTime(), lang);

  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('me.links.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {rows && rows.length === 0 && !error ? <Txt color={k.muted}>{t('me.links.empty')}</Txt> : null}
      {(rows ?? []).map(r => (
        <View key={r.code} style={{ gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: k.line }}>
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


/** Kehila menu › הזמנת מתפלל (members and gabbaim): create a listener link and manage "הקישורים שלי". Moved here from Me unchanged. */
export function InviteListener({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const kehila = state.kehila;
  const [busy, setBusy] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  if (!kehila) return null;
  async function invite() {
    if (!kehila || busy) return;
    setBusy(true); setInviteError(null); setCreated(null);
    try {
      const r = await api.createInvite(kehila.kehilaId);
      setCreated(r.code); setVersion(v => v + 1);
    } catch (e) {
      setInviteError(e instanceof ApiCodeError && e.code === 'too_many_invites' ? t('me.links.tooMany') : errText(e));
    } finally { setBusy(false); }
  }
  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Card>
        <Txt serif size="heading" accessibilityRole="header">{t('me.invite.title')}</Txt>
        <Txt size="small" color={k.muted}>{t('me.invite.body')}</Txt>
        {inviteError ? <Banner tone="error" text={inviteError} /> : null}
        {created ? <Banner tone="success" text={t('me.invite.ready')} /> : null}
        {created ? <LinkShare code={created} onToast={onToast} /> : <Button title={t('me.invite.create')} onPress={() => void invite()} busy={busy} />}
        {created ? <Button kind="secondary" title={t('me.invite.create')} onPress={() => void invite()} busy={busy} /> : null}
      </Card>
      <MyLinks kehilaId={kehila.kehilaId} version={version} onToast={onToast} />
    </PadScroll>
  );
}
