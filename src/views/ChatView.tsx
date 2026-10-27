import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { CHAT_MAX, canSendChat, timeOfDay, visibleList } from '../client/messageView.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Sheet, Txt, useTokens } from '../kit/components.tsx';
import { useAuth } from '../auth/AuthProvider.tsx';
import { CHAT_LIMIT_MAX, exitTarget } from '../client/channelsView.ts';
import { Composer } from '../kit/Composer.tsx';
import { ImageThumb } from '../kit/ImageThumb.tsx';
import { AttachButton, AttachPreview } from '../kit/ImageAttach.tsx';
import { TOUCH } from '../kit/theme.ts';
import type { Picked } from '../media/device.ts';
import { sendMessage } from '../media/send.ts';
import type { Stage } from '../media/send.ts';
import { singleFlight } from '../client/singleFlight.ts';
import { useErrorText } from './auth/Frame.tsx';

/** Chat view of a conversation channel: bubbles with author and time, no titles, newest at the bottom. */
export function ChatView({ channelId, onBack }: { channelId: string; onBack: () => void }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { api } = useAuth();
  const { state, postMessage, requestUpload, refreshChannels, refreshKehila } = useSession();
  const { feed, channels, kehila, me } = state;
  const [draft, setDraft] = React.useState('');
  const [image, setImage] = React.useState<Picked | null>(null);
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [limitOpen, setLimitOpen] = React.useState(false);
  const [limitText, setLimitText] = React.useState('');
  const [limitBusy, setLimitBusy] = React.useState(false);
  const [limitError, setLimitError] = React.useState<string | null>(null);
  const limitOnce = React.useRef(singleFlight(() => limitSave.current())).current;
  const limitSave = React.useRef<() => Promise<void>>(async () => {});
  const alive = React.useRef(true);
  const latest = React.useRef<() => Promise<void>>(async () => {});
  const sendOnce = React.useRef(singleFlight(() => latest.current())).current;
  React.useEffect(() => () => { alive.current = false; }, []);
  const scroller = React.useRef<ScrollView>(null);
  const channel = channels.find(c => c.channelId === channelId);
  if (!kehila || !channel) return null;
  const busy = stage !== null;
  const limitOk = /^\d+$/.test(limitText.trim()) && +limitText <= CHAT_LIMIT_MAX;
  limitSave.current = async () => {
    if (!limitOk || !state.kehilaId) return;
    setLimitBusy(true); setLimitError(null);
    try {
      await api.setChatLimit(state.kehilaId, channelId, +limitText);
      await refreshChannels().catch(() => {});
      if (alive.current) setLimitOpen(false);
    } catch (e) {
      if (exitTarget((e as { code?: unknown } | null)?.code, 'limit') === 'chat') {
        void refreshChannels().catch(() => {}); void refreshKehila().catch(() => {});
        if (alive.current) { setLimitOpen(false); setError(t('messages.limit.noRights')); }
      } else if (alive.current) setLimitError(errText(e));
    } finally { if (alive.current) setLimitBusy(false); }
  };
  latest.current = send;
  async function send() {
    if (busy || !canSendChat(draft, !!image)) return;
    setError(null);
    const text = draft.trim();
    try {
      await sendMessage({ image, channelId, requestUpload, post: id => postMessage({ channelId, body: text, ...(id ? { imageUploadId: id } : {}) }), onStage: s => { if (alive.current) setStage(s); } });
      if (alive.current) { setDraft(''); setImage(null); setStage(null); }
    } catch (e) {
      if (alive.current) { setError(errText(e)); setStage(null); }
    }
  }
  // Oldest first, so the newest message ends up at the bottom.
  const list = visibleList(feed, { mode: 'all', channelId, notify: kehila.notify, channels }).slice().reverse();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('detail.back')} onPress={onBack} style={{ minWidth: TOUCH, minHeight: TOUCH, justifyContent: 'center' }}>
          <Txt size="heading" color={k.tekhelet}>{dir === 'rtl' ? '›' : '‹'}</Txt>
        </Pressable>
        <Txt serif size="title" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>{channel.name}</Txt>
        {channel.isAdmin ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('messages.limit.button')} onPress={() => { setLimitText(String(channel.chatHourlyLimit)); setLimitError(null); setLimitOpen(true); }} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
            <Txt size="small" bold color={k.tekhelet}>{t('messages.limit.button')}</Txt>
          </Pressable>
        ) : null}
      </View>
      <Sheet visible={limitOpen} title={t('messages.limit.title')} onClose={() => setLimitOpen(false)} footer={<Button title={t('messages.limit.save')} busy={limitBusy} disabled={!limitOk} onPress={() => void limitOnce()} />}>
        <Field label={t('messages.limit.field')} value={limitText} onChangeText={setLimitText} keyboardType="number-pad" editable={!limitBusy} error={limitOk ? null : t('messages.limit.invalid')} />
        <Txt size="small" color={k.muted}>{t('messages.limit.zero')}</Txt>
        {limitError ? <Banner tone="error" text={limitError} /> : null}
      </Sheet>
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: 16, gap: 10, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {list.length === 0 ? <Txt color={k.muted}>{t('messages.chatEmpty')}</Txt> : null}
        {list.map(m => {
          const mine = m.authorId === me?.userId;
          return (
            <View key={m.messageId} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', gap: 4, padding: 10, borderRadius: 14, backgroundColor: mine ? k.tekhelet : k.surface, borderWidth: mine ? 0 : 1, borderColor: k.line }}>
              {!mine ? <Txt size="caption" bold color={k.muted}>{m.authorName}</Txt> : null}
              {m.image ? <ImageThumb messageId={m.messageId} contentType={m.image.contentType} /> : null}
              {m.body ? <Txt color={mine ? k.onAction : k.ink}>{m.body}</Txt> : null}
              <Txt size="caption" color={mine ? k.onAction : k.muted} style={{ alignSelf: 'flex-end' }}>{timeOfDay(m.messageId)}</Txt>
            </View>
          );
        })}
      </ScrollView>
      {channel.canPost ? (
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.stone, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
          {image ? <View style={{ paddingBottom: 8 }}><AttachPreview image={image} onRemove={() => setImage(null)} disabled={busy} /></View> : null}
          {stage ? <Txt size="small" color={k.muted} style={{ paddingBottom: 8 }} accessibilityRole="alert">{t(`compose.progress.${stage}`)}</Txt> : null}
          {error ? <View style={{ paddingBottom: 8 }}><Banner tone="error" text={error} /></View> : null}
          <Composer value={draft} onChange={setDraft} maxCodePoints={CHAT_MAX} placeholder={t('messages.chatPlaceholder')} onSend={() => void sendOnce()} busy={busy}
            allowEmpty={!!image} extras={<AttachButton disabled={busy || !!image} onPicked={setImage} onDenied={() => setError(t('compose.permissionDenied'))} />} />
        </View>
      ) : null}
    </View>
  );
}
