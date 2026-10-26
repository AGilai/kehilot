import React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { BODY_MAX, TITLE_MAX, canPublish, needsTarget, postBody, postableChannels } from '../client/messageView.ts';
import type { Draft } from '../client/messageView.ts';
import type { DirectoryEntry, MessageType } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { textStart } from '../i18n/direction.ts';
import { Banner, Button, Chip, Field, Screen, Txt, useTokens } from '../kit/components.tsx';
import { Composer } from '../kit/Composer.tsx';
import { AttachButton, AttachPreview } from '../kit/ImageAttach.tsx';
import { TOUCH, fonts, type as scale } from '../kit/theme.ts';
import type { Picked } from '../media/device.ts';
import { sendMessage } from '../media/send.ts';
import type { Stage } from '../media/send.ts';
import { singleFlight } from '../client/singleFlight.ts';
import { Stripe } from './MessageRow.tsx';
import { useErrorText } from './auth/Frame.tsx';

const TYPES: Array<Exclude<MessageType, 'chat'>> = ['weekly', 'celebration', 'condolence', 'event'];

export type ComposeInitial = { type?: MessageType; targetId?: string; image?: Picked };

/**
 * M4 (members) and GM3 (gabbaim): one screen. Type cards, channel, title, text, an optional image, and for a
 * celebration or condolence the family it is about. The audience line names the channel only: the API has no
 * recipient count.
 */
export function Compose({ onBack, onPublished, initial }: { onBack: () => void; onPublished: (messageId: string) => void; initial?: ComposeInitial }) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { state, postMessage, requestUpload, directory } = useSession();
  const channels = React.useMemo(() => postableChannels(state.channels), [state.channels]);
  const [type, setType] = React.useState<MessageType>(initial?.type ?? 'weekly');
  const [channelId, setChannelId] = React.useState<string | null>(channels[0]?.channelId ?? null);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [targetId, setTargetId] = React.useState<string | null>(initial?.targetId ?? null);
  const [image, setImage] = React.useState<Picked | null>(initial?.image ?? null);
  const [q, setQ] = React.useState('');
  const [people, setPeople] = React.useState<DirectoryEntry[] | null | 'error'>(null);
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  const latest = React.useRef<() => Promise<void>>(async () => {});
  const publishOnce = React.useRef(singleFlight(() => latest.current())).current;
  React.useEffect(() => () => { alive.current = false; }, []);

  // Only the targets that are valid for the chosen channel (a group channel's own members).
  const wantTargets = needsTarget(type) && !!channelId;
  React.useEffect(() => {
    if (!wantTargets) return;
    let live = true;
    setPeople(null);
    directory(channelId!).then(l => { if (live) setPeople(l); }, () => { if (live) setPeople('error'); });
    return () => { live = false; };
  }, [wantTargets, channelId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A channel that is no longer postable after a refresh is dropped for the first one that is.
  React.useEffect(() => {
    if (!channels.some(c => c.channelId === channelId)) setChannelId(channels[0]?.channelId ?? null);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps
  // A target that is no longer a valid choice for this channel is dropped.
  React.useEffect(() => {
    if (Array.isArray(people) && targetId && !people.some(p => p.userId === targetId)) setTargetId(null);
  }, [people]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft: Draft = { type, channelId, title, body, targetMemberId: targetId };
  const busy = stage !== null;
  const ok = canPublish(draft) && !busy;
  const channelName = channels.find(c => c.channelId === channelId)?.name ?? '';
  const gabbai = state.kehila?.role === 'gabbai';
  const shown = Array.isArray(people) ? people.filter(p => p.displayName.toLowerCase().includes(q.trim().toLowerCase())) : [];

  latest.current = publish;
  async function publish() {
    if (!ok || !channelId) return;
    setError(null);
    try {
      const m = await sendMessage({ image, channelId, requestUpload, post: id => postMessage(postBody(draft, id)), onStage: s => { if (alive.current) setStage(s); } });
      if (alive.current) onPublished(m.messageId);
    } catch (e) {
      if (alive.current) { setError(errText(e)); setStage(null); }
    }
  }

  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Txt bold color={k.tekhelet}>{dir === 'rtl' ? '›' : '‹'} {t('common.back')}</Txt>
      </Pressable>
      <Txt serif size="title" accessibilityRole="header">{t(gabbai ? 'compose.titleGabbai' : 'compose.titleMember')}</Txt>

      <View style={{ gap: 8 }}>
        <Txt size="small" bold>{t('compose.type')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TYPES.map(x => (
            <Pressable key={x} accessibilityRole="button" accessibilityState={{ selected: type === x }} disabled={busy} onPress={() => { setType(x); setTargetId(null); setQ(''); }}
              style={{ flexBasis: '47%', flexGrow: 1 }}>
              <View style={{ flexDirection: 'row', minHeight: TOUCH + 8, borderRadius: 12, overflow: 'hidden', backgroundColor: k.surface, borderWidth: type === x ? 2 : 1, borderColor: type === x ? k.tekhelet : k.line }}>
                <Stripe type={x} />
                <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}><Txt bold>{t(`compose.types.${x}`)}</Txt></View>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Txt size="small" bold>{t('compose.channel')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {channels.map(c => <Chip key={c.channelId} label={c.name} selected={channelId === c.channelId} onPress={() => { if (!busy) { setChannelId(c.channelId); setTargetId(null); } }} />)}
        </View>
      </View>

      {needsTarget(type) ? (
        <View style={{ gap: 8 }}>
          <Txt size="small" bold>{t('compose.family')}</Txt>
          <TextInput accessibilityLabel={t('compose.familySearch')} placeholder={t('compose.familySearch')} placeholderTextColor={k.muted} value={q} onChangeText={setQ}
            style={{ minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: scale.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) }} />
          {people === null ? <ActivityIndicator color={k.tekhelet} /> : null}
          {people === 'error' ? <Txt size="small" color={k.danger} accessibilityRole="alert">{t('compose.familyLoadError')}</Txt> : null}
          {Array.isArray(people) && shown.length === 0 ? <Txt size="small" color={k.muted}>{t('compose.familyNone')}</Txt> : null}
          <View style={{ gap: 6 }}>
            {shown.slice(0, 8).map(p => (
              <Pressable key={p.userId} accessibilityRole="button" accessibilityState={{ selected: targetId === p.userId }} disabled={busy} onPress={() => setTargetId(p.userId)}
                style={{ minHeight: TOUCH, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, borderWidth: targetId === p.userId ? 2 : 1, borderColor: targetId === p.userId ? k.tekhelet : k.line, backgroundColor: k.surface }}>
                <Txt bold={targetId === p.userId}>{targetId === p.userId ? '✓ ' : ''}{p.displayName}</Txt>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <Field label={t('compose.titleField')} value={title} onChangeText={setTitle} maxCodePoints={TITLE_MAX} editable={!busy} />
      <View style={{ gap: 6 }}>
        <Txt size="small" bold>{t('compose.bodyField')}</Txt>
        <Composer value={body} onChange={setBody} maxCodePoints={BODY_MAX} placeholder={t('compose.bodyField')} disabled={busy}
          extras={<AttachButton disabled={busy || !!image} onPicked={setImage} onDenied={() => setError(t('compose.permissionDenied'))} />} />
      </View>
      {image ? <AttachPreview image={image} onRemove={() => setImage(null)} disabled={busy} /> : null}

      {channelName ? <Txt size="small" color={k.muted}>{t('compose.audience', { channel: channelName })}</Txt> : null}
      {stage ? <Txt size="small" color={k.muted} accessibilityRole="alert">{t(`compose.progress.${stage}`)}</Txt> : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Button title={t('compose.publish')} onPress={() => void publishOnce()} busy={busy} disabled={!ok} />
    </Screen>
  );
}
