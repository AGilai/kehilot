import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { InviteRow } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { LinkShare } from '../Me.tsx';
import { useAdminErrText, useShortDate } from './shared.tsx';

/** Every unexpired invite of the Kehila (a gabbai sees all), with share and revoke. */
export function InviteList({ rows, onChanged, onToast }: { rows: InviteRow[]; onChanged: () => Promise<void>; onToast: (text: string) => void }) {
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
