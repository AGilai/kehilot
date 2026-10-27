import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { config } from '../../config.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import { channelForm, lockListeners, lockNote, needsOpenConfirm, toRequest, CHAT_LIMIT_MAX } from '../../client/channelsView.ts';
import { singleFlight } from '../../client/singleFlight.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Channel, ChannelFields, Group } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Chip, Field, Sheet, Toggle, Txt, useTokens } from '../../kit/components.tsx';
import { BackLink } from '../Me.tsx';
import { Choice, Tag, useAdminErrText } from './shared.tsx';

const NAME_MAX = 60;

/** The create/edit sheet. `channel` undefined = new. */
function ChannelSheet({ open, channel, groups, onClose, onSaved }: { open: boolean; channel?: Channel; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state, refreshChannels } = useSession();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [form, setForm] = React.useState<ChannelFields>(channelForm());
  const [limitText, setLimitText] = React.useState('30');
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const f = channelForm(channel);
    setForm(f); setLimitText(String(f.chatHourlyLimit ?? 30)); setConfirm(false); setError(null);
  }, [open, channel]);

  const locked = lockListeners(form);
  const note = lockNote(form);
  const limitOk = /^\d+$/.test(limitText.trim()) && +limitText <= CHAT_LIMIT_MAX;
  const nameOk = form.name.trim().length > 0 && [...form.name.trim()].length <= NAME_MAX;
  const canSave = nameOk && (!form.conversation || limitOk);
  const current: ChannelFields = { ...form, chatHourlyLimit: limitOk ? +limitText : form.chatHourlyLimit };
  const toggleGroup = (g: string) => setForm(f => ({ ...f, groups: f.groups.includes(g) ? f.groups.filter(x => x !== g) : [...f.groups, g] }));
  const save = React.useRef<() => Promise<void>>(async () => {});
  const once = React.useRef(singleFlight(() => save.current())).current;
  save.current = async () => {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      const body = toRequest(current);
      if (channel) await api.updateChannel(kehilaId, channel.channelId, body); else await api.createChannel(kehilaId, body);
      void refreshChannels().catch(() => {});
      onSaved();
    } catch (e) { setError(errText(e)); setConfirm(false); } finally { setBusy(false); }
  };
  function press() {
    if (channel && !confirm && needsOpenConfirm(channelForm(channel), current)) { setConfirm(true); return; }
    void once();
  }

  return (
    <Sheet visible={open} title={t(channel ? 'admin.channels.sheetEdit' : 'admin.channels.sheetNew')} onClose={onClose}>
      <Field label={t('admin.channels.name')} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} maxCodePoints={NAME_MAX} editable={!busy} />
      <View pointerEvents={locked ? 'none' : 'auto'} style={{ opacity: locked ? 0.5 : 1 }}>
        <Toggle label={t('admin.channels.listeners')} value={locked ? false : form.listenersCanRead} onChange={v => setForm(f => ({ ...f, listenersCanRead: v }))}
          offNote={note ? t(note === 'groups' ? 'admin.channels.lockGroups' : 'admin.channels.lockConversation') : undefined} />
      </View>
      <Txt size="small" bold>{t('admin.channels.policyLabel')}</Txt>
      <Choice label={t('admin.channels.policyOpt.management')} note="" selected={form.postPolicy === 'management'} onPress={() => setForm(f => ({ ...f, postPolicy: 'management' }))} />
      <Choice label={t('admin.channels.policyOpt.broadcasters')} note="" selected={form.postPolicy === 'broadcasters'} onPress={() => setForm(f => ({ ...f, postPolicy: 'broadcasters' }))} />
      <Toggle label={t('admin.channels.conversation')} value={form.conversation} onChange={v => setForm(f => ({ ...f, conversation: v }))} />
      {form.conversation ? (
        <>
          <Field label={t('admin.channels.limitField')} value={limitText} onChangeText={setLimitText} keyboardType="number-pad" editable={!busy} error={limitOk ? null : t('admin.channels.limitInvalid')} />
          {limitOk && +limitText === 0 ? <Txt size="small">{t('admin.channels.limitZero')}</Txt> : null}
        </>
      ) : null}
      <Txt size="small" bold>{t('admin.channels.groups')}</Txt>
      {groups.length === 0 ? <Txt size="small">{t('admin.channels.groupsNone')}</Txt> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {groups.map(g => <Chip key={g.groupId} label={g.name} selected={form.groups.includes(g.groupId)} onPress={() => toggleGroup(g.groupId)} />)}
        </View>
      )}
      <Txt size="small">{t('admin.channels.groupsHint')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {confirm ? (
        <>
          <Banner tone="info" text={t('admin.channels.openConfirm')} />
          <Button kind="danger" title={t('admin.channels.openYes')} busy={busy} onPress={() => void once()} />
          <Button kind="secondary" title={t('admin.channels.back')} disabled={busy} onPress={() => setConfirm(false)} />
        </>
      ) : <Button title={t('admin.channels.save')} busy={busy} disabled={!canSave} onPress={press} />}
    </Sheet>
  );
}

/** Gabbai: a plain list of the channels, and the create/edit sheet. */
export function Channels({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [rows, setRows] = React.useState<Channel[] | null>(null);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<{ channel?: Channel } | null>(null);
  const load = React.useCallback(async () => {
    const [c, g] = await Promise.allSettled([api.channels(kehilaId), api.groups(kehilaId)]);
    if (c.status === 'fulfilled') { setRows(c.value); setError(null); } else { setError(errText(c.reason)); setRows(prev => prev ?? []); }
    if (g.status === 'fulfilled') setGroups(g.value);
    // Fixtures: ?screen=channel-sheet opens the conversation channel's sheet once.
    if (config.fixtures && c.status === 'fulfilled' && fixtureParams().screen === 'channel-sheet') setSheet(cur => cur ?? { channel: c.value.find(x => x.conversation) });
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);
  const names = new Map(groups.map(g => [g.groupId, g.name]));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('admin.channels.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      <Button title={t('admin.channels.new')} onPress={() => setSheet({})} />
      {rows === null ? <ActivityIndicator color={k.tekhelet} /> : null}
      {rows && rows.length === 0 && !error ? <Txt color={k.muted}>{t('admin.channels.empty')}</Txt> : null}
      {(rows ?? []).map(c => (
        <Card key={c.channelId}>
          <Txt bold size="heading">{c.name}</Txt>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {c.conversation ? <Tag tone="strong" label={t('admin.channels.tagConversation')} /> : null}
            {c.listenersCanRead ? <Tag label={t('admin.channels.tagListeners')} /> : null}
            {(c.groups ?? []).length === 0 ? <Tag label={t('admin.channels.tagAll')} /> : (c.groups ?? []).map(g => names.get(g)).filter((n): n is string => !!n).map(n => <Tag key={n} label={n} />)}
          </View>
          <Button kind="secondary" title={t('admin.channels.edit')} onPress={() => setSheet({ channel: c })} />
        </Card>
      ))}
      <ChannelSheet open={sheet !== null} channel={sheet?.channel} groups={groups} onClose={() => setSheet(null)}
        onSaved={() => { setSheet(null); onToast(t('admin.channels.saved')); void load(); }} />
    </ScrollView>
  );
}
