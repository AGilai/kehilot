import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { ApiCodeError } from '../../client/errors.ts';
import { keyedFlight } from '../../client/singleFlight.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Group } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Txt, useTokens } from '../../kit/components.tsx';
import { BackLink } from '../Me.tsx';
import { Tag, useAdminErrText } from './shared.tsx';

const NAME_MAX = 60;

/** Gabbai: the groups with member, channel, admin and pending counts; create, rename, delete (confirmed). */
export function Groups({ onBack, onOpen, onToast }: { onBack: () => void; onOpen: (g: Group) => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [rows, setRows] = React.useState<Group[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const flight = React.useRef(keyedFlight()).current;

  const load = React.useCallback(async () => {
    try { setRows(await api.groups(kehilaId)); setError(null); } catch (e) { setError(errText(e)); setRows(prev => prev ?? []); }
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);

  const nameError = (e: unknown): string => {
    if (e instanceof ApiCodeError && e.code === 'group_name_taken') return t('errors.group_name_taken');
    if (e instanceof ApiCodeError && e.code === 'too_many_groups') return t('errors.too_many_groups');
    return errText(e);
  };
  const valid = (s: string) => s.trim().length > 0 && [...s.trim()].length <= NAME_MAX;

  async function create() {
    await flight('create', async () => {
      if (!valid(name)) return;
      setBusy('create'); setError(null);
      try { await api.createGroup(kehilaId, name.trim()); setName(''); setCreating(false); onToast(t('admin.groups.created')); await load(); }
      catch (e) { setError(nameError(e)); } finally { setBusy(null); }
    });
  }
  async function rename(id: string, to: string) {
    await flight(id, async () => {
      if (!valid(to)) return;
      setBusy(id); setRowError(null);
      try { await api.renameGroup(kehilaId, id, to.trim()); setRenaming(null); onToast(t('admin.groups.renamed')); await load(); }
      catch (e) { setRowError({ id, text: nameError(e) }); } finally { setBusy(null); }
    });
  }
  async function remove(g: Group) {
    await flight(g.groupId, async () => {
      setBusy(g.groupId); setRowError(null);
      try { await api.deleteGroup(kehilaId, g.groupId); setAsking(null); onToast(t('admin.groups.deleted')); await load(); }
      catch (e) {
        if (e instanceof ApiCodeError && e.code === 'group_in_use') { setAsking(null); setRowError({ id: g.groupId, text: t('admin.groups.inUse', { n: g.channelCount }) }); await load(); }
        else if (e instanceof ApiCodeError && e.code === 'group_not_found') { setAsking(null); await load(); }
        else setRowError({ id: g.groupId, text: errText(e) });
      } finally { setBusy(null); }
    });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('admin.groups.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {creating ? (
        <Card>
          <Field label={t('admin.groups.nameField')} value={name} onChangeText={setName} maxCodePoints={NAME_MAX} editable={busy !== 'create'} />
          <Button title={t('admin.groups.create')} onPress={() => void create()} busy={busy === 'create'} disabled={!valid(name)} />
          <Button kind="secondary" title={t('admin.groups.cancel')} onPress={() => { setCreating(false); setName(''); setError(null); }} disabled={busy === 'create'} />
        </Card>
      ) : <Button title={t('admin.groups.new')} onPress={() => setCreating(true)} />}
      {rows === null ? <ActivityIndicator color={k.tekhelet} /> : null}
      {rows && rows.length === 0 && !error ? <Txt color={k.muted}>{t('admin.groups.empty')}</Txt> : null}
      {(rows ?? []).map(g => (
        <Card key={g.groupId}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Txt bold size="heading" style={{ flexShrink: 1 }}>{g.name}</Txt>
            {g.pendingCount > 0 ? <Tag tone="strong" label={t('admin.groups.pending', { n: g.pendingCount })} /> : null}
          </View>
          <Txt size="small" color={k.muted}>{t('admin.groups.counts', { members: g.memberCount, channels: g.channelCount })}</Txt>
          <Txt size="small" color={k.muted}>{t('admin.groups.admins', { n: g.adminCount })}</Txt>
          {rowError?.id === g.groupId ? <Banner tone="error" text={rowError.text} /> : null}
          {renaming?.id === g.groupId ? (
            <>
              <Field label={t('admin.groups.nameField')} value={renaming.name} onChangeText={v => setRenaming({ id: g.groupId, name: v })} maxCodePoints={NAME_MAX} editable={busy !== g.groupId} />
              <Button title={t('admin.groups.save')} onPress={() => void rename(g.groupId, renaming.name)} busy={busy === g.groupId} disabled={!valid(renaming.name)} />
              <Button kind="secondary" title={t('admin.groups.cancel')} onPress={() => { setRenaming(null); setRowError(null); }} disabled={busy === g.groupId} />
            </>
          ) : asking === g.groupId ? (
            <>
              <Txt>{t('admin.groups.deleteConfirm', { name: g.name })}</Txt>
              <Button kind="danger" title={t('admin.groups.deleteYes')} onPress={() => void remove(g)} busy={busy === g.groupId} />
              <Button kind="secondary" title={t('admin.groups.keep')} onPress={() => setAsking(null)} disabled={busy === g.groupId} />
            </>
          ) : (
            <>
              <Button title={t('admin.groups.open')} onPress={() => onOpen(g)} />
              <Button kind="secondary" title={t('admin.groups.rename')} onPress={() => { setRenaming({ id: g.groupId, name: g.name }); setRowError(null); }} />
              <Button kind="secondary" title={t('admin.groups.delete')} onPress={() => { setAsking(g.groupId); setRowError(null); }} />
            </>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
