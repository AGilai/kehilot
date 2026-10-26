import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { timeOfDay, visibleList } from '../client/messageView.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../kit/components.tsx';
import { Composer } from '../kit/Composer.tsx';
import { ImageThumb } from '../kit/ImageThumb.tsx';
import { TOUCH } from '../kit/theme.ts';

/** Chat view of a conversation channel: bubbles with author and time, no titles, newest at the bottom. */
export function ChatView({ channelId, onBack }: { channelId: string; onBack: () => void }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const { feed, channels, kehila, me } = state;
  const [draft, setDraft] = React.useState('');
  const scroller = React.useRef<ScrollView>(null);
  const channel = channels.find(c => c.channelId === channelId);
  if (!kehila || !channel) return null;
  // Oldest first, so the newest message ends up at the bottom.
  const list = visibleList(feed, { mode: 'all', channelId, notify: kehila.notify, channels }).slice().reverse();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('detail.back')} onPress={onBack} style={{ minWidth: TOUCH, minHeight: TOUCH, justifyContent: 'center' }}>
          <Txt size="heading" color={k.tekhelet}>{dir === 'rtl' ? '›' : '‹'}</Txt>
        </Pressable>
        <Txt serif size="title" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>{channel.name}</Txt>
      </View>
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: 16, gap: 10, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {list.length === 0 ? <Txt color={k.muted}>{t('messages.chatEmpty')}</Txt> : null}
        {list.map(m => {
          const mine = m.authorId === me?.userId;
          return (
            <View key={m.messageId} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', gap: 4, padding: 10, borderRadius: 14, backgroundColor: mine ? k.tekhelet : k.surface, borderWidth: mine ? 0 : 1, borderColor: k.line }}>
              {!mine ? <Txt size="caption" bold color={k.muted}>{m.authorName}</Txt> : null}
              {m.image ? <ImageThumb messageId={m.messageId} /> : null}
              {m.body ? <Txt color={mine ? k.onAction : k.ink}>{m.body}</Txt> : null}
              <Txt size="caption" color={mine ? k.onAction : k.muted} style={{ alignSelf: 'flex-end' }}>{timeOfDay(m.messageId)}</Txt>
            </View>
          );
        })}
      </ScrollView>
      {channel.canPost ? (
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.stone, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
          {/* Sending is wired in Task 13. */}
          <Composer value={draft} onChange={setDraft} maxCodePoints={1000} placeholder={t('messages.chatPlaceholder')} onSend={() => {}} />
        </View>
      ) : null}
    </View>
  );
}
