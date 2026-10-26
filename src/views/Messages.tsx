import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, SectionList, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSession } from '../client/SessionProvider.tsx';
import { groupByDay, isMuted, visibleList } from '../client/messageView.ts';
import { israelDate } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Chip, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { MessageRow } from './MessageRow.tsx';

export type Filter = 'mine' | 'all';
export const filterKey = (userId: string, k: string) => `kehilot.filter.${userId}.${k}`;

/** M2: "mine / everything", channel chips (a chat channel's chip opens its chat), messages grouped by Israel day. */
export function Messages({ onOpen, onChat, onNew, onSearch, initialFilter }: { onOpen: (id: string) => void; onChat: (channelId: string) => void; onNew?: () => void; onSearch?: () => void; initialFilter?: Filter }) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const { feed, channels, kehila, me, kehilaId } = state;
  const [filter, setFilter] = React.useState<Filter>(initialFilter ?? 'mine');
  const [channelId, setChannelId] = React.useState<string | null>(null);
  const key = me && kehilaId ? filterKey(me.userId, kehilaId) : null;

  // The choice is remembered per Kehila on this device.
  React.useEffect(() => {
    if (!key || initialFilter) return;
    let live = true;
    AsyncStorage.getItem(key).then(v => { if (live && (v === 'mine' || v === 'all')) setFilter(v); }, () => {});
    return () => { live = false; };
  }, [key, initialFilter]);
  function choose(f: Filter) {
    setFilter(f);
    if (key) void AsyncStorage.setItem(key, f).catch(() => {});
  }

  if (!kehila) return null;
  const notify = kehila.notify;
  const list = visibleList(feed, { mode: filter, channelId: channelId ?? undefined, notify, channels });
  const sections = groupByDay(list).map(g => ({ day: g.day, data: g.items }));
  const today = israelDate();
  const dayLabel = (day: string) => day === today ? t('messages.today')
    : day ? new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00+02:00`)) : '';
  const canPostSomewhere = channels.some(c => c.canPost && !c.conversation);
  const nameOf = (id: string) => channels.find(c => c.channelId === id)?.name ?? '';

  const header = (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt serif size="title" accessibilityRole="header">{t('messages.title')}</Txt>
        {onSearch ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('search.open')} onPress={onSearch}
            style={{ minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size="heading" color={k.tekhelet}>🔍</Txt>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label={t('messages.filterMine')} selected={filter === 'mine'} onPress={() => choose('mine')} />
        <Chip label={t('messages.filterAll')} selected={filter === 'all'} onPress={() => choose('all')} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label={t('messages.allChannels')} selected={channelId === null} onPress={() => setChannelId(null)} />
        {channels.map(c => (
          <Chip key={c.channelId} label={c.conversation ? `💬 ${c.name}` : c.name} selected={!c.conversation && channelId === c.channelId}
            onPress={() => (c.conversation ? onChat(c.channelId) : setChannelId(c.channelId))} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <SectionList
        sections={sections}
        keyExtractor={m => m.messageId}
        ListHeaderComponent={header}
        stickySectionHeadersEnabled={false}
        initialNumToRender={6}
        windowSize={5}
        contentContainerStyle={{ padding: 16, paddingBottom: 96, gap: 10, width: '100%', maxWidth: 680, alignSelf: 'center' }}
        renderSectionHeader={({ section }) => <Txt size="small" bold color={k.muted} style={{ paddingTop: 8 }}>{dayLabel(section.day)}</Txt>}
        renderItem={({ item }) => (
          <MessageRow message={item} channelName={nameOf(item.channelId)} muted={isMuted(item, notify, channels)} onPress={() => onOpen(item.messageId)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
        ListEmptyComponent={!feed.loaded ? <ActivityIndicator color={k.tekhelet} /> : <Txt color={k.muted}>{t('messages.empty')}</Txt>}
      />
      {canPostSomewhere ? (
        <Pressable accessibilityRole="button" onPress={onNew}
          style={{ position: 'absolute', ...(dir === 'rtl' ? { left: 16 } : { right: 16 }), bottom: 16, minHeight: TOUCH, paddingHorizontal: 20, borderRadius: 28, backgroundColor: k.tekhelet, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 }}>
          <Txt bold color={k.onAction}>＋ {t('messages.new')}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
