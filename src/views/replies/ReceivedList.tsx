import React from 'react';
import { Pressable, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { receivedOrder, receivedTitle, replyTime } from '../../client/replyView.ts';
import type { Message, Reply } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Card, Tag, Txt, useTokens } from '../../kit/components.tsx';

/**
 * §22.5 / P48 phone 4: what reached the recipient. Newest first; an unread reply has an 8 px pomegranate dot; one sent to
 * this person alone carries the "אישית" Tag with a lock. After render it tells the server the newest is seen. The dots
 * stay for this visit (the store clears its own flags at once).
 */
export function ReceivedList({ message, replies, onLayout }: { message: Message; replies: Reply[]; onLayout?: (e: LayoutChangeEvent) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { state, markRepliesSeen } = useSession();
  const items = receivedOrder(replies, state.me?.userId ?? '');
  const [fresh, setFresh] = React.useState<Set<string>>(() => new Set());
  const newest = items[0]?.reply.replyId;
  const anyUnread = items.some(x => x.reply.unread);
  React.useEffect(() => {
    if (!anyUnread) return;
    setFresh(prev => new Set([...prev, ...items.filter(x => x.reply.unread).map(x => x.reply.replyId)]));
    if (newest) void markRepliesSeen(message.messageId, newest).catch(() => {});
  }, [newest, anyUnread]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = Date.now();
  if (items.length === 0) return null;
  return (
    <View onLayout={onLayout} style={{ gap: 8 }}>
      <Txt bold size="heading" accessibilityRole="header">{receivedTitle(message, t)}</Txt>
      <Txt size="small" color={k.muted}>{t('reply.onlyYou')}</Txt>
      {items.map(({ reply: r, personal }) => (
        <ReceivedRow key={r.replyId} reply={r} personal={personal} unread={!!r.unread || fresh.has(r.replyId)} now={now} />
      ))}
    </View>
  );
}

/**
 * One received reply: name bold (a link when `onName` is given), the personal Tag, the time and "· נערכה", the text, and an
 * 8 px pomegranate dot before an unread one. `flat` drops the Card (the mailbox puts rows inside its own card).
 */
export function ReceivedRow({ reply: r, personal, unread, now, flat, onName }: { reply: Reply; personal: boolean; unread: boolean; now: number; flat?: boolean; onName?: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const name = r.authorName.trim() ? r.authorName : t('reply.formerMember');
  const when = replyTime(r.createdAt, lang, now, t);
  const body = (
    <>
      <View accessible={!onName} accessibilityLabel={`${unread ? t('reply.unreadA11y') + '. ' : ''}${name}${personal ? '. ' + t('reply.personalTag') : ''}. ${when}`}
        style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k.pomegranate }} /> : null}
        {onName
          ? <Pressable accessibilityRole="link" accessibilityLabel={name} onPress={onName} style={{ minHeight: 32, justifyContent: 'center' }}><Txt size="small" bold content color={k.tekhelet}>{name}</Txt></Pressable>
          : <Txt size="small" bold content>{name}</Txt>}
        {personal ? <Tag tone="pomegranate" icon="lock" label={t('reply.personalTag')} /> : null}
        <Txt size="small" color={k.muted}>{'· '}{when}{r.updatedAt ? ` · ${t('reply.edited')}` : ''}</Txt>
      </View>
      <Txt content>{r.body}</Txt>
    </>
  );
  return flat ? <View style={{ gap: 4, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: k.line }}>{body}</View> : <Card>{body}</Card>;
}
