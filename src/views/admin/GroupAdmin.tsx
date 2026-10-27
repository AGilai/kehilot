import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { ApiCodeError } from '../../client/errors.ts';
import { canAppoint, canRemoveFromGroup, exitTarget } from '../../client/channelsView.ts';
import { keyedFlight } from '../../client/singleFlight.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import type { GroupMemberRow, GroupRequestRow } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { BackLink } from '../Me.tsx';
import { useErrorText } from '../auth/Frame.tsx';
import { useShortDate } from './shared.tsx';

/** One group: its members (remove, appoint), and the pending join requests (approve, reject). For gabbaim and for the group's admins. */
export function GroupAdmin({ group, onBack, onGone, onToast }: { group: { groupId: string; name: string }; onBack: () => void; /** The admin rights ended (403): leave to Me. */ onGone: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state, refreshKehila } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  /** A 403 ends the screen with its own text and reloads the Kehila record (adminGroups); true when it left. */
  const gone = (e: unknown): boolean => {
    if (exitTarget((e as { code?: unknown } | null)?.code, 'group') !== 'me') return false;
    void refreshKehila().catch(() => {});
    onToast(t('admin.groupAdmin.noRights')); onGone();
    return true;
  };
  const date = useShortDate();
  const kehilaId = state.kehilaId!;
  const role = state.kehila?.role;
  const g = group.groupId;
  const [members, setMembers] = React.useState<GroupMemberRow[] | null>(null);
  const [requests, setRequests] = React.useState<GroupRequestRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<{ id: string; text: string } | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const flight = React.useRef(keyedFlight()).current;

  const load = React.useCallback(async () => {
    const [m, r] = await Promise.allSettled([api.groupMembers(kehilaId, g), api.groupRequests(kehilaId, g)]);
    const failed = [m, r].find(x => x.status === 'rejected');
    if (failed && failed.status === 'rejected' && gone(failed.reason)) return;
    setError(failed && failed.status === 'rejected' ? errText(failed.reason) : null);
    if (m.status === 'fulfilled') setMembers(m.value); else setMembers(prev => prev ?? []);
    if (r.status === 'fulfilled') setRequests(r.value); else setRequests(prev => prev ?? []);
  }, [api, kehilaId, g]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);

  /** Runs one call per person at a time; a person who is gone (request or member not found) just refreshes the lists. */
  async function act(id: string, call: () => Promise<unknown>, done: string, then?: () => void) {
    await flight(id, async () => {
      setBusy(id); setRowError(null);
      try { await call(); then?.(); onToast(done); await load(); }
      catch (e) {
        if (e instanceof ApiCodeError && (e.code === 'request_not_found' || e.code === 'member_not_found')) { then?.(); await load(); }
        else if (!gone(e)) setRowError({ id, text: errText(e) });
      } finally { setBusy(null); }
    });
  }

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{group.name}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}

      <Txt serif size="heading" accessibilityRole="header">{t('admin.groupAdmin.requests')}</Txt>
      {requests === null ? <ActivityIndicator color={k.tekhelet} /> : null}
      {requests && requests.length === 0 && !error ? <Txt color={k.muted}>{t('admin.groupAdmin.requestsEmpty')}</Txt> : null}
      {(requests ?? []).map(r => (
        <Card key={r.userId}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Txt bold size="heading" style={{ flexShrink: 1 }}>{r.displayName}</Txt>
            <Tag label={t(`admin.members.role.${r.role}`)} />
          </View>
          <Txt size="small" color={k.muted}>{t('admin.groupAdmin.since', { date: date(r.createdAt) })}</Txt>
          {rowError?.id === r.userId ? <Banner tone="error" text={rowError.text} /> : null}
          <Button title={t('admin.groupAdmin.approve')} busy={busy === r.userId} onPress={() => void act(r.userId, () => api.approveGroupRequest(kehilaId, g, r.userId), t('admin.groupAdmin.approved'))} />
          <Button kind="secondary" title={t('admin.groupAdmin.reject')} disabled={busy === r.userId} onPress={() => void act(r.userId, () => api.rejectGroupRequest(kehilaId, g, r.userId), t('admin.groupAdmin.rejected'))} />
        </Card>
      ))}

      <Txt serif size="heading" accessibilityRole="header">{t('admin.groupAdmin.members')}</Txt>
      {members === null ? <ActivityIndicator color={k.tekhelet} /> : null}
      {members && members.length === 0 && !error ? <Txt color={k.muted}>{t('admin.groupAdmin.membersEmpty')}</Txt> : null}
      {(members ?? []).map(m => {
        const mayRemove = canRemoveFromGroup(role, m);
        return (
          <Card key={m.userId}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Txt bold size="heading" style={{ flexShrink: 1 }}>{m.displayName}</Txt>
              <Tag label={t(`admin.members.role.${m.role}`)} tone={m.role === 'gabbai' ? 'strong' : 'plain'} />
              {m.isAdmin && m.role !== 'gabbai' ? <Tag tone="strong" label={t('admin.groupAdmin.adminBadge')} /> : null}
            </View>
            {rowError?.id === m.userId ? <Banner tone="error" text={rowError.text} /> : null}
            {role === 'gabbai' && canAppoint(m) ? (
              <Button kind="secondary" title={t('admin.groupAdmin.appoint')} busy={busy === m.userId} onPress={() => void act(m.userId, () => api.appointGroupAdmin(kehilaId, g, m.userId), t('admin.groupAdmin.appointed'))} />
            ) : null}
            {role === 'gabbai' && m.role === 'member' && m.isAdmin ? (
              <Button kind="secondary" title={t('admin.groupAdmin.unappoint')} busy={busy === m.userId} onPress={() => void act(m.userId, () => api.unappointGroupAdmin(kehilaId, g, m.userId), t('admin.groupAdmin.unappointed'))} />
            ) : null}
            {m.userId === state.me?.userId ? null : !mayRemove ? <Txt size="small" color={k.muted}>{t('admin.groupAdmin.onlyGabbai')}</Txt> : asking === m.userId ? (
              <>
                <Txt>{t('admin.groupAdmin.removeConfirm', { name: m.displayName })}</Txt>
                <Button kind="danger" title={t('admin.groupAdmin.removeYes')} busy={busy === m.userId} onPress={() => void act(m.userId, () => api.removeGroupMember(kehilaId, g, m.userId), t('admin.groupAdmin.removed'), () => setAsking(null))} />
                <Button kind="secondary" title={t('admin.groupAdmin.keep')} disabled={busy === m.userId} onPress={() => setAsking(null)} />
              </>
            ) : <Button kind="secondary" title={t('admin.groupAdmin.remove')} onPress={() => { setAsking(m.userId); setRowError(null); }} />}
          </Card>
        );
      })}
    </PadScroll>
  );
}
