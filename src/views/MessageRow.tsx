import React from 'react';
import { Platform, Pressable, View, useColorScheme } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../kit/components.tsx';
import { ImageThumb } from '../kit/ImageThumb.tsx';
import { Icon } from '../kit/Icon.tsx';
import { edge } from '../kit/theme.ts';
import { LONG_PRESS_MS } from './replies/CardActions.tsx';
import { ReplyRow, previewHasRow } from './replies/ReplyRow.tsx';
import { buttonLabel, buttonState } from '../client/replyView.ts';
import { useSession } from '../client/SessionProvider.tsx';
import type { Message } from '../client/types.ts';

/** The start-edge stripe: a double line in the type colour, dotted when the message is muted. */
export function Stripe({ type, muted }: { type: Message['type']; muted?: boolean }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const color = edge(type, scheme);
  if (muted) return <View style={{ width: 6, alignSelf: 'stretch', borderWidth: 3, borderStyle: 'dotted', borderColor: color }} />;
  return (
    <View style={{ width: 6, alignSelf: 'stretch', flexDirection: 'row', gap: 2 }}>
      <View style={{ width: 2, backgroundColor: color }} /><View style={{ width: 2, backgroundColor: color }} />
    </View>
  );
}

/** One message in a list: stripe, type, channel (with several) and time, title, two lines of body, optional image, the reply row (count and button). Never reply text. */
export type CardReply = { unreadNew: number; onReply: () => void; onOpenReplies: () => void; onActions: () => void };

export function MessageRow({ message, meta, muted, onPress, reply, previewReply }: {
  message: Message; meta: string; muted: boolean; onPress: () => void;
  /** The list's reply row, long press and web `more` button. Home rows and the weekly sheet pass none. */
  reply?: CardReply;
  /** The compose preview: a static reply row with a disabled pill. */
  previewReply?: boolean;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const role = state.kehila?.role;
  const canReply = !!reply && !!role && buttonState(message, role) === 'reply';
  const unread = message.type !== 'chat' && !message.read;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      onLongPress={reply ? reply.onActions : undefined} delayLongPress={LONG_PRESS_MS}
      accessibilityActions={reply ? [{ name: 'actions', label: t('actions.title') }, ...(canReply ? [{ name: 'reply', label: buttonLabel(message, t) }] : [])] : undefined}
      onAccessibilityAction={reply ? (e => { if (e.nativeEvent.actionName === 'actions') reply.onActions(); else if (e.nativeEvent.actionName === 'reply') reply.onReply(); }) : undefined}
      style={{ flexDirection: 'row', backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, overflow: 'hidden', opacity: muted ? 0.7 : 1 }}>
      <Stripe type={message.type} muted={muted} />
      <View style={{ flex: 1, padding: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt size="caption" color={k.muted} numberOfLines={1} style={{ flexShrink: 1 }}>{meta}</Txt>
          {muted ? <Txt size="caption" bold color={k.muted}>{t('messages.muted')}</Txt> : null}
          <View style={{ flex: 1 }} />
          {reply && Platform.OS === 'web' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('actions.title')} onPress={reply.onActions} hitSlop={8}
              style={{ width: 48, height: 48, margin: -12, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="more" size={20} color={k.muted} />
            </Pressable>
          ) : null}
          {unread ? <View accessibilityLabel={t('messages.unread')} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: k.tekhelet }} /> : null}
        </View>
        {message.title ? <Txt content serif size="heading" numberOfLines={2}>{message.title}</Txt> : null}
        {message.body ? <Txt content size="small" color={k.muted} numberOfLines={2}>{message.body}</Txt> : null}
        {message.image ? <ImageThumb messageId={message.messageId} contentType={message.image.contentType} /> : null}
        {reply ? <ReplyRow message={message} unreadNew={reply.unreadNew} onReply={reply.onReply} onOpenReplies={reply.onOpenReplies} />
          : previewReply && previewHasRow(message) ? <ReplyRow message={message} preview /> : null}
      </View>
    </Pressable>
  );
}
