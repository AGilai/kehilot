import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useColorScheme } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import type { Hit } from '../search/hit.ts';
import { canUpdate, joinLabel, timeOfDay, ulidTime } from '../client/messageView.ts';
import { buttonState, countText, deleteMessageBody, myReply, needsReplyFields, replyKind, withReplyFields } from '../client/replyView.ts';
import { dualDateAt } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Sheet, Txt, useTokens } from '../kit/components.tsx';
import { ReplyBox } from './replies/ReplyBox.tsx';
import { ReceivedList } from './replies/ReceivedList.tsx';
import { MyReply } from './replies/MyReply.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { ImageThumb } from '../kit/ImageThumb.tsx';
import { TOUCH, edge } from '../kit/theme.ts';
import { roleFeatures } from '../client/roleView.ts';
import { useErrorText } from './auth/Frame.tsx';
import { BackIcon, Icon } from '../kit/Icon.tsx';
import { messageMeta } from '../client/typesView.ts';
import { isAdult, isManagement } from '../client/roles.ts';
import { CancelledTag, ChangeLine, MetaText, UpdatedFooter } from './UpdatedParts.tsx';

/**
 * M3: the full message. The server returns only the replies this caller may read (the recipient's, or the
 * caller's own); anyone else sees the count and no text. Under the card: the received list (recipient), my reply with
 * edit and delete (replier) or the reply box. `focus` scrolls to the received list or to my reply.
 */
export function MessageDetail({ messageId, onBack, focus, onUpdate }: { messageId: string; onBack: () => void; focus?: 'received' | 'mine'; /** Opens Compose in update mode (only given to screens that can). */ onUpdate?: () => void }) {
  const { t, dir, lang } = useI18n();
  const k = useTokens();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const errText = useErrorText();
  const { state, markRead, loadReplies, join, removeMessage, loadHit, setNotify } = useSession();
  const { feed, kehila, me, channels } = state;
  // An older message (a search hit) is not in the feed: it is fetched and held here, never added to the list.
  const [hit, setHit] = React.useState<Hit | undefined>(undefined);
  const inFeed = feed.messages[messageId];
  const fetched = hit?.kind === 'full' ? hit.message : undefined;
  // The feed list never carries `replyAdults` / `replyBlocked` (the "אל מי" picker and the pre-send banners): they come from the single GET.
  const message = inFeed ? withReplyFields(inFeed, fetched) : fetched;
  const [error, setError] = React.useState<string | null>(null);
  const scroll = React.useRef<ScrollView>(null);
  const ys = React.useRef<{ received?: number; mine?: number }>({});
  const touched = React.useRef(false);
  // y of the section relative to the scroll content (both sections are direct children of it). Re-run when the content grows, until the user scrolls.
  const go = () => { const y = focus ? ys.current[focus] : undefined; if (y !== undefined && !touched.current) scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: false }); };
  const place = (key: 'received' | 'mine') => (e: LayoutChangeEvent) => { ys.current[key] = e.nativeEvent.layout.y; if (focus === key) setTimeout(go, 0); };
  const [joined, setJoined] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    if (inFeed || !feed.loaded) return;
    let live = true;
    loadHit(messageId).then(h => { if (live) setHit(h); }, () => { if (live) setHit({ kind: 'notFound' }); });
    return () => { live = false; };
  }, [messageId, !!inFeed, feed.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const wantsFields = !!inFeed && needsReplyFields(inFeed) && !hit;
  React.useEffect(() => {
    if (!wantsFields) return;
    let live = true;
    loadHit(messageId).then(h => { if (live) setHit(h); }, () => {});
    return () => { live = false; };
  }, [messageId, wantsFields]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!message) return;
    void markRead(messageId);
    if (isAdult(kehila?.role) && (message.replyTo || message.targetMemberId)) void loadReplies(messageId).catch(() => {});
  }, [messageId, !!message, message?.replyTo, message?.targetMemberId, kehila?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!kehila || !me) return null;
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('detail.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('detail.back')}</Txt></View>
    </Pressable>
  );
  const copy = hit?.kind === 'copy' ? hit.copy : null;
  if (!message && copy) {
    const date = Number.isFinite(ulidTime(messageId))
      ? dualDateAt(ulidTime(messageId), lang, { year: true }) : '';
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {back}
        <Banner text={t('detail.offlineCopy')} />
        <Card edgeColor={edge(copy.type, scheme)}>
          <Txt size="caption" color={k.muted}>{messageMeta(copy, channels, date, t)}</Txt>
          {copy.title ? <Txt content serif size="title" accessibilityRole="header">{copy.title}</Txt> : null}
          {copy.body ? <Txt content>{copy.body}</Txt> : null}
          <Txt size="small" color={k.muted}>{t('detail.from', { name: copy.authorName })}</Txt>
          {copy.targetName ? <Txt content size="small" color={k.muted}>{copy.targetName}</Txt> : null}
        </Card>
      </PadScroll>
    );
  }
  if (!message) {
    return <View style={{ padding: 16, gap: 12 }}>{back}{hit?.kind === 'notFound' ? <Txt>{t('detail.notFound')}</Txt> : <ActivityIndicator color={k.tekhelet} />}</View>;
  }

  const role = kehila.role;
  const isTarget = !!message.isRecipient;
  const all = feed.replies[messageId] ?? [];
  const mine = myReply(all, me.userId);
  const older = all.filter(r => r.authorId === me.userId && r !== mine).sort((a, b) => (a.replyId < b.replyId ? 1 : -1));
  const isReceiver = isTarget || all.some(r => r.personal);
  const chip = countText(message, t);
  const showBox = !mine && buttonState(message, role) === 'reply';
  const canJoin = (message.type === 'celebration' || message.type === 'condolence') && roleFeatures(role).join && !isTarget;
  // Mute (or unmute) notifications from the member who broadcast this; it never hides the message.
  const canMute = roleFeatures(role).directory && message.authorKind === 'member' && message.type !== 'chat' && message.authorId !== me.userId;
  const authorMuted = kehila.notify.mutedMembers.includes(message.authorId);
  const canDelete = message.authorId === me.userId || isManagement(role);
  
  // §19.2a: the author, management and the bereaved family's adults. The card sits under the message so the reply UI below keeps its place.
  const updateCard = onUpdate && canUpdate(message, me.userId, kehila) ? (
    <Card>
      <Txt size="small" color={k.muted}>{t('msg.update.only')}</Txt>
      <Button kind={message.type === 'condolence' && message.fields?.variant === 'full' || message.type === 'event' ? 'secondary' : 'primary'}
        title={t(message.type === 'condolence' ? 'msg.update.shiva' : 'msg.update.event')} onPress={onUpdate} />
    </Card>
  ) : null;

  async function doJoin() {
    if (joining || joined) return;
    setJoining(true); setError(null);
    try { await join(messageId); setJoined(true); } catch (e) { setError(errText(e)); } finally { setJoining(false); }
  }
  async function doMute() {
    setError(null);
    const list = kehila!.notify.mutedMembers.filter(x => x !== message!.authorId);
    try { await setNotify({ mutedMembers: authorMuted ? list : [...list, message!.authorId] }); } catch (e) { setError(errText(e)); }
  }
  async function doDelete() {
    setConfirm(false);
    try { await removeMessage(messageId); onBack(); } catch (e) { setError(errText(e)); }
  }

  return (
    <PadScroll ref={scroll} onScrollBeginDrag={() => { touched.current = true; }} onContentSizeChange={go} contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      {back}
      <Card edgeColor={edge(message.type, scheme)}>
        <MetaText message={message} meta={messageMeta(message, channels, timeOfDay(messageId), t)} />
        {message.title ? <Txt content serif size="title" accessibilityRole="header">{message.title}</Txt> : null}
        <CancelledTag message={message} />
        <ChangeLine message={message} />
        {message.body ? <Txt content>{message.body}</Txt> : null}
        {message.image ? <ImageThumb messageId={messageId} contentType={message.image.contentType} /> : null}
        <Txt size="small" color={k.muted}>{t('detail.from', { name: message.authorName })}</Txt>
        <UpdatedFooter message={message} />
      </Card>

      {updateCard}

      {chip ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={replyKind(message.type) === 'general' ? 'lock' : 'heart'} size={16} color={k.muted} />
          <Txt size="small" bold color={k.muted}>{chip}</Txt>
        </View>
      ) : null}
      {canJoin ? <Button kind={joined ? 'secondary' : 'primary'} title={joined ? t('detail.joined') : joinLabel(message.type, message.joinCount, t)} onPress={() => void doJoin()} busy={joining} disabled={joined} /> : null}
      {error ? <Banner tone="error" text={error} /> : null}

      {isReceiver ? <ReceivedList message={message} replies={all} onLayout={place('received')} /> : null}

      {mine ? (
        <View style={{ gap: 8 }} onLayout={place('mine')}>
          {older.map(r => (
            <Card key={r.replyId} edgeColor={k.olive}><Txt content color={k.muted}>{r.body}</Txt></Card>
          ))}
          <MyReply key={mine.replyId} message={message} reply={mine} />
        </View>
      ) : null}

      {showBox ? <ReplyBox message={message} onSent={() => {}} />
        : !mine && message.replyBlocked === 'target_left' ? <Banner text={t('detail.familyGone')} />
        : !mine && message.replyBlocked === 'author_left' ? <Banner text={t('reply.authorGone')} /> : null}

      {canMute ? <Button kind="secondary" title={authorMuted ? t('detail.unmuteMember') : t('detail.muteMember')} onPress={() => void doMute()} /> : null}
      {canDelete ? <Button kind="danger" title={t('detail.delete')} onPress={() => setConfirm(true)} /> : null}
      <Sheet visible={confirm} title={t('detail.deleteTitle')} onClose={() => setConfirm(false)}>
        <Txt>{deleteMessageBody(message.replierCount, t)}</Txt>
        <Button kind="danger" title={t('detail.deleteYes')} onPress={() => void doDelete()} />
      </Sheet>
    </PadScroll>
  );
}
