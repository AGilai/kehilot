import React from 'react';
import { Pressable, View, useColorScheme } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../kit/components.tsx';
import { ImageThumb } from '../kit/ImageThumb.tsx';
import { edge } from '../kit/theme.ts';
import { replierChip, timeOfDay } from '../client/messageView.ts';
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

/** One message in a list: stripe, channel and time, title, two lines of body, optional image, replier chip. Never reply text. */
export function MessageRow({ message, channelName, muted, onPress }: { message: Message; channelName: string; muted: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const chip = replierChip(message, t);
  const unread = message.type !== 'chat' && !message.read;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={{ flexDirection: 'row', backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, overflow: 'hidden', opacity: muted ? 0.7 : 1 }}>
      <Stripe type={message.type} muted={muted} />
      <View style={{ flex: 1, padding: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt size="caption" color={k.muted} numberOfLines={1} style={{ flexShrink: 1 }}>{channelName} · {timeOfDay(message.messageId)}</Txt>
          {muted ? <Txt size="caption" bold color={k.muted}>{t('messages.muted')}</Txt> : null}
          <View style={{ flex: 1 }} />
          {unread ? <View accessibilityLabel={t('messages.unread')} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: k.tekhelet }} /> : null}
        </View>
        {message.title ? <Txt serif size="heading" numberOfLines={2}>{message.title}</Txt> : null}
        {message.body ? <Txt size="small" color={k.muted} numberOfLines={2}>{message.body}</Txt> : null}
        {message.image ? <ImageThumb messageId={message.messageId} contentType={message.image.contentType} /> : null}
        {chip ? <Txt size="caption" bold color={k.muted}>{chip}</Txt> : null}
      </View>
    </Pressable>
  );
}
