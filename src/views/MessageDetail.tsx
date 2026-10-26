import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useColorScheme } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { canReply, joinLabel, replierChip, timeOfDay, visibleReplies } from '../client/messageView.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Sheet, Txt, useTokens } from '../kit/components.tsx';
import { Composer } from '../kit/Composer.tsx';
import { ImageThumb } from '../kit/ImageThumb.tsx';
import { TOUCH, edge } from '../kit/theme.ts';
import { useErrorText } from './auth/Frame.tsx';

/** Reply errors that end the chance to reply to this message. */
const HIDES_BOX = ['cannot_reply_to_own', 'replies_not_allowed', 'target_left'];

/**
 * M3: the full message. Private blessings show here and nowhere else, and only to the target (all of them)
 * or to their own author (their own). A gabbai who is neither sees the replier chip and no text.
 */
export function MessageDetail({ messageId, onBack }: { messageId: string; onBack: () => void }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const errText = useErrorText();
  const { state, markRead, loadReplies, sendReply, join, removeMessage } = useSession();
  const { feed, kehila, me, channels } = state;
  const message = feed.messages[messageId];
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState<string | null>(null);
  const [joined, setJoined] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const targeted = !!message?.targetMemberId;

  React.useEffect(() => {
    if (!message) return;
    void markRead(messageId);
    // The server returns only the replies this caller may read (none for most gabbaim).
    if (targeted) void loadReplies(messageId).catch(() => {});
  }, [messageId, !!message, targeted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!kehila || !me) return null;
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('detail.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <Txt bold color={k.tekhelet}>{dir === 'rtl' ? '›' : '‹'} {t('detail.back')}</Txt>
    </Pressable>
  );
  if (!message) {
    return <View style={{ padding: 16, gap: 12 }}>{back}{feed.loaded ? <Txt>{t('detail.notFound')}</Txt> : <ActivityIndicator color={k.tekhelet} />}</View>;
  }

  const role = kehila.role;
  const isTarget = message.targetMemberId === me.userId;
  const replies = visibleReplies(message, feed.replies[messageId] ?? [], me.userId);
  const chip = replierChip(message, t);
  const showBox = canReply(message, me.userId, role) && !blocked;
  const canJoin = (message.type === 'celebration' || message.type === 'condolence') && role !== 'listener' && !isTarget;
  const canDelete = message.authorId === me.userId || role === 'gabbai';
  const familyName = message.targetName?.trim() || t('chip.formerMember');
  const channelName = channels.find(c => c.channelId === message.channelId)?.name ?? '';

  async function doJoin() {
    if (joining || joined) return;
    setJoining(true); setError(null);
    try { await join(messageId); setJoined(true); } catch (e) { setError(errText(e)); } finally { setJoining(false); }
  }
  async function doSend() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try { await sendReply(messageId, body); setDraft(''); }
    catch (e) {
      const code = (e as { code?: string } | null)?.code ?? '';
      if (HIDES_BOX.includes(code)) setBlocked(code);
      else setError(errText(e));
    } finally { setBusy(false); }
  }
  async function doDelete() {
    setConfirm(false);
    try { await removeMessage(messageId); onBack(); } catch (e) { setError(errText(e)); }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      {back}
      <Card edgeColor={edge(message.type, scheme)}>
        <Txt size="caption" color={k.muted}>{channelName} · {timeOfDay(messageId)}</Txt>
        {message.title ? <Txt serif size="title" accessibilityRole="header">{message.title}</Txt> : null}
        {message.body ? <Txt>{message.body}</Txt> : null}
        {message.image ? <ImageThumb messageId={messageId} /> : null}
        <Txt size="small" color={k.muted}>{t('detail.from', { name: message.authorName })}</Txt>
      </Card>

      {chip ? <Txt size="small" bold color={k.muted}>{chip}</Txt> : null}
      {canJoin ? <Button kind={joined ? 'secondary' : 'primary'} title={joined ? t('detail.joined') : joinLabel(message.type, message.joinCount, t)} onPress={() => void doJoin()} busy={joining} disabled={joined} /> : null}
      {error ? <Banner tone="error" text={error} /> : null}

      {isTarget ? (
        <View style={{ gap: 8 }}>
          <Txt bold size="heading">{t('detail.received')}</Txt>
          {replies.map(r => (
            <Card key={r.replyId}>
              <Txt size="small" bold color={k.muted}>{r.authorName}</Txt>
              <Txt>{r.body}</Txt>
            </Card>
          ))}
        </View>
      ) : null}

      {!isTarget && replies.length > 0 ? (
        <View style={{ gap: 8 }}>
          {replies.map(r => (
            <Card key={r.replyId} edgeColor={k.olive}>
              <Txt size="caption" bold color={k.olive}>{t('detail.sent')}</Txt>
              <Txt>{r.body}</Txt>
            </Card>
          ))}
        </View>
      ) : null}

      {blocked === 'target_left' ? <Banner text={t('detail.familyGone')} /> : null}
      {showBox ? (
        <View style={{ gap: 8 }}>
          <Txt bold size="heading">{t('detail.replyTitle')}</Txt>
          <Composer value={draft} onChange={setDraft} maxCodePoints={1000} placeholder={t('detail.replyPlaceholder')}
            lockLine={t('detail.lock', { name: familyName })} onSend={() => void doSend()} busy={busy} />
        </View>
      ) : null}

      {canDelete ? <Button kind="danger" title={t('detail.delete')} onPress={() => setConfirm(true)} /> : null}
      <Sheet visible={confirm} title={t('detail.deleteTitle')} onClose={() => setConfirm(false)}>
        <Txt>{t('detail.deleteBody')}</Txt>
        <Button kind="danger" title={t('detail.deleteYes')} onPress={() => void doDelete()} />
      </Sheet>
    </ScrollView>
  );
}
