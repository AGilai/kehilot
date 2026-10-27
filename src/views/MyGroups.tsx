import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { keyedFlight } from '../client/singleFlight.ts';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useSession } from '../client/SessionProvider.tsx';
import type { GroupMembership } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { Tag } from './admin/shared.tsx';
import { useErrorText } from './auth/Frame.tsx';

/**
 * "קבוצות" on Me, for every role (listeners too): the community's groups with ask to join / withdraw / leave.
 * No member names or counts. A group admin also gets "הקבוצות שאני מנהל/ת" with a button to the group's screen.
 */
export function MyGroups({ onManage, onToast }: { onManage?: (g: { groupId: string; name: string }) => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state, refreshKehila } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const kehilaId = state.kehilaId;
  const [rows, setRows] = React.useState<GroupMembership[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<{ id: string; text: string } | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const flight = React.useRef(keyedFlight()).current;

  const load = React.useCallback(async () => {
    if (!kehilaId) return;
    try { setRows(await api.myGroups(kehilaId)); setError(null); } catch (e) { setError(errText(e)); setRows(prev => prev ?? []); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);

  async function act(g: GroupMembership, call: () => Promise<unknown>, done: string) {
    await flight(g.groupId, async () => {
      setBusy(g.groupId); setRowError(null);
      try { await call(); setAsking(null); onToast(done); await load(); }
      catch (e) {
        if ((e as { code?: unknown } | null)?.code === 'forbidden') void refreshKehila().catch(() => {});
        await load(); setRowError({ id: g.groupId, text: errText(e) });
      } finally { setBusy(null); }
    });
  }
  if (!kehilaId) return null;
  const mine = (rows ?? []).filter(g => g.isAdmin);
  return (
    <>
      {mine.length > 0 && onManage ? (
        <Card>
          <Txt serif size="heading" accessibilityRole="header">{t('me.groups.mineTitle')}</Txt>
          {mine.map(g => <Button key={g.groupId} kind="secondary" title={`${t('me.groups.manage')}: ${g.name}`} onPress={() => onManage({ groupId: g.groupId, name: g.name })} />)}
        </Card>
      ) : null}
      <Card>
        <Txt serif size="heading" accessibilityRole="header">{t('me.groups.title')}</Txt>
        {error ? <Banner tone="error" text={error} /> : null}
        {rows === null ? <ActivityIndicator color={k.tekhelet} /> : null}
        {rows && rows.length === 0 && !error ? <Txt color={k.muted}>{t('me.groups.empty')}</Txt> : null}
        {(rows ?? []).map(g => (
          <View key={g.groupId} style={{ gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: k.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Txt bold style={{ flexShrink: 1 }}>{g.name}</Txt>
              {g.isMember ? <Tag tone="strong" label={t('me.groups.member')} /> : null}
              {g.isAdmin ? <Tag label={t('me.groups.admin')} /> : null}
              {!g.isMember && g.requested ? <Tag label={t('me.groups.requested')} /> : null}
            </View>
            {rowError?.id === g.groupId ? <Banner tone="error" text={rowError.text} /> : null}
            {g.isMember ? (asking === g.groupId ? (
              <>
                <Txt size="small">{t('me.groups.leaveConfirm', { name: g.name })}</Txt>
                <Button kind="danger" title={t('me.groups.leaveYes')} busy={busy === g.groupId} onPress={() => void act(g, () => api.leaveGroup(kehilaId, g.groupId), t('me.groups.left'))} />
                <Button kind="secondary" title={t('me.groups.keep')} disabled={busy === g.groupId} onPress={() => setAsking(null)} />
              </>
            ) : <Button kind="secondary" title={t('me.groups.leave')} onPress={() => { setAsking(g.groupId); setRowError(null); }} />)
              : g.requested ? <Button kind="secondary" title={t('me.groups.withdraw')} busy={busy === g.groupId} onPress={() => void act(g, () => api.withdrawGroupRequest(kehilaId, g.groupId), t('me.groups.withdrawn'))} />
              : <Button kind="secondary" title={t('me.groups.request')} busy={busy === g.groupId} onPress={() => void act(g, () => api.requestGroup(kehilaId, g.groupId), t('me.groups.requestSent'))} />}
          </View>
        ))}
      </Card>
    </>
  );
}
