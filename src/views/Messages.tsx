import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, SectionList, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSession } from '../client/SessionProvider.tsx';
import { channelLabel } from '../client/channelsView.ts';
import { groupByDay, isMuted, timeOfDay, visibleList } from '../client/messageView.ts';
import { showCompose } from '../client/roleView.ts';
import { filterMessages, filterTypeChips, mergeArchive, messageMeta, showChannelChips } from '../client/typesView.ts';
import type { Message, MessageType } from '../client/types.ts';
import { israelDate } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { textStart } from '../i18n/direction.ts';
import { Button, Chip, Segmented, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { fonts, TOUCH, edge, type } from '../kit/theme.ts';
import { queryWords } from '../search/normalize.ts';
import type { CachedMessage } from '../search/cache.ts';
import { MessageRow } from './MessageRow.tsx';

export type Filter = 'mine' | 'all';
export const filterKey = (userId: string, k: string) => `kehilot.filter.${userId}.${k}`;

/**
 * M2: "mine / everything", search field, channel chips (only with several channels; a chat channel's chip opens
 * its chat), type chips (several can be on), messages grouped by Israel day. Text runs over the whole on-device archive.
 */
export function Messages({ onOpen, onChat, onNew, initialFilter, initialQuery = '' }: { onOpen: (id: string) => void; onChat: (channelId: string) => void; onNew?: () => void; initialFilter?: Filter; initialQuery?: string }) {
  const { t, lang, dir } = useI18n();
  const { width } = useWindowDimensions();
  const k = useTokens();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { state, search, cacheStatus } = useSession();
  const { feed, channels, kehila, me, kehilaId } = state;
  const [filter, setFilter] = React.useState<Filter>(initialFilter ?? 'mine');
  const [channelId, setChannelId] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const [text, setText] = React.useState(initialQuery);
  const [debounced, setDebounced] = React.useState(initialQuery);
  const [types, setTypes] = React.useState<MessageType[]>([]);
  const [archive, setArchive] = React.useState<CachedMessage[]>([]);
  const [status, setStatus] = React.useState({ complete: true, count: 0 });
  const key = me && kehilaId ? filterKey(me.userId, kehilaId) : null;

  // The choice is remembered per Kehila on this device.
  React.useEffect(() => {
    if (!key || initialFilter) return;
    let live = true;
    AsyncStorage.getItem(key).then(v => { if (live && (v === 'mine' || v === 'all')) setFilter(v); }, () => {});
    return () => { live = false; };
  }, [key, initialFilter]);
  // Filters live while the tab is mounted; another Kehila starts clean.
  const firstKehila = React.useRef(kehilaId);
  React.useEffect(() => {
    if (firstKehila.current === kehilaId) return;
    firstKehila.current = kehilaId;
    setChannelId(null); setText(''); setDebounced(''); setTypes([]);
  }, [kehilaId]);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(timer);
  }, [text]);
  const hasText = queryWords(debounced).length > 0;
  // The archive fills in the background; follow its progress while text is being searched and it is incomplete.
  React.useEffect(() => {
    if (!hasText) return;
    let live = true;
    const poll = () => cacheStatus().then(s => { if (live) setStatus(s); }, () => {});
    void poll();
    const timer = setInterval(() => { if (!status.complete) void poll(); }, 500);
    return () => { live = false; clearInterval(timer); };
  }, [hasText, cacheStatus, status.complete]);
  React.useEffect(() => {
    if (!hasText) { setArchive([]); return; }
    let live = true;
    search(debounced, channelId ? { channelId } : {}).then(r => { if (live) setArchive(r); }, () => { if (live) setArchive([]); });
    return () => { live = false; };
  }, [debounced, channelId, hasText, status.count, search]);

  if (!kehila) return null;
  const notify = kehila.notify;
  const multiChannel = showChannelChips(channels);
  const filtered = (mode: Filter): Message[] => {
    const base = visibleList(feed, { mode, channelId: channelId ?? undefined, notify, channels });
    const rows = hasText
      ? mergeArchive(base, archive.filter(c => channels.some(x => x.channelId === c.channelId) && (mode === 'all' || !isMuted({ ...c, authorId: '', authorKind: 'management', joinCount: 0 }, notify, channels))))
      : base;
    return filterMessages(rows, { text: debounced, types });
  };
  const list = filtered(filter);
  const active = hasText || types.length > 0 || channelId !== null;
  const inAll = filter === 'mine' && active && list.length === 0 ? filtered('all').length : 0;
  const sections = groupByDay(list).map(g => ({ day: g.day, data: g.items }));
  const today = israelDate();
  const dayLabel = (day: string) => day === today ? t('messages.today')
    : day ? new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00+02:00`)) : '';
  const canPostSomewhere = !!onNew && showCompose(kehila.role, channels);
  // A mouse cannot drag a horizontal scroller: on wide web windows the chips wrap.
  const wrapChips = Platform.OS === 'web' && width >= 600;

  function choose(f: Filter) {
    setFilter(f);
    if (key) void AsyncStorage.setItem(key, f).catch(() => {});
  }
  const clearAll = () => { setText(''); setDebounced(''); setTypes([]); setChannelId(null); };
  const toggleType = (x: MessageType) => setTypes(cur => (cur.includes(x) ? cur.filter(y => y !== x) : [...cur, x]));

  const row = (children: React.ReactNode) => wrapChips ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>{children}</ScrollView>
  );
  const channelChips = (
    <>
      <Chip size="filter" label={t('messages.allChannels')} selected={channelId === null} onPress={() => setChannelId(null)} />
      {channels.map(c => (
        <Chip key={c.channelId} size="filter" icon={c.conversation ? 'msg' : undefined} label={channelLabel(c, t)} selected={!c.conversation && channelId === c.channelId}
          onPress={() => (c.conversation ? onChat(c.channelId) : setChannelId(c.channelId))} />
      ))}
    </>
  );
  const typeChips = (
    <>
      {filterTypeChips(kehila.role, Object.values(feed.messages)).map(x => (
        <Chip key={x} size="filter" multi dot={edge(x, scheme)} label={t(`compose.types.${x}`)} selected={types.includes(x)} onPress={() => toggleType(x)} />
      ))}
    </>
  );
  const header = (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <Txt serif size="title" accessibilityRole="header">{t('messages.title')}</Txt>
      <Segmented value={filter} onChange={choose} options={[{ key: 'mine', label: t('messages.filterMine') }, { key: 'all', label: t('messages.filterAll') }]} />
      <View style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', borderWidth: focused ? 2 : 1, borderRadius: 10, borderColor: focused ? k.tekhelet : k.line, backgroundColor: k.surface, paddingStart: focused ? 11 : 12 }}>
        <View style={{ marginEnd: 2 }}><Icon name="search" size={20} color={k.muted} /></View>
        <TextInput accessibilityRole="search" accessibilityLabel={t('messages.search')} placeholder={t('messages.search')} placeholderTextColor={k.muted}
          value={text} onChangeText={setText} returnKeyType="search" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{ flex: 1, minHeight: TOUCH - 4, paddingHorizontal: 10, borderWidth: 0, backgroundColor: 'transparent', color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang), ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as object) : {}) }} />
        {text ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('messages.searchClear')} onPress={() => { setText(''); setDebounced(''); }}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={20} color={k.muted} />
          </Pressable>
        ) : null}
      </View>
      {hasText && !status.complete ? <Txt size="small" color={k.muted} accessibilityRole="alert">{t('messages.archiveLoading', { n: status.count })}</Txt> : null}
      {multiChannel ? row(channelChips) : null}
      <View role="group" accessibilityLabel={t('messages.typesLabel')}>{row(typeChips)}</View>
      {active ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH }}>
          <Txt size="small" color={k.muted} accessibilityLiveRegion="polite">{list.length === 1 ? t('messages.countOne') : t('messages.count', { n: list.length })}</Txt>
          <Pressable accessibilityRole="button" onPress={clearAll} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
            <Txt size="small" bold color={k.tekhelet}>{t('messages.clearFilters')}</Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
  const empty = !feed.loaded ? <ActivityIndicator color={k.tekhelet} /> : active ? (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
      <Txt color={k.muted} style={{ textAlign: 'center' }}>{t('messages.emptyFiltered')}</Txt>
      {inAll > 0 ? (
        <View style={{ alignItems: 'center' }}>
          <Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{t('messages.inAll', { n: inAll })}</Txt>
          <Pressable accessibilityRole="button" onPress={() => choose('all')} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
            <Txt size="small" bold color={k.tekhelet}>{t('messages.showAll')}</Txt>
          </Pressable>
        </View>
      ) : null}
      <Button kind="secondary" title={t('messages.clearFilters')} onPress={clearAll} />
    </View>
  ) : <Txt color={k.muted}>{t('messages.empty')}</Txt>;

  return (
    <View style={{ flex: 1 }}>
      <SectionList
        sections={sections}
        keyExtractor={m => m.messageId}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        initialNumToRender={6}
        windowSize={5}
        contentContainerStyle={{ padding: 16, paddingBottom: 96, gap: 10, width: '100%', maxWidth: 680, alignSelf: 'center' }}
        renderSectionHeader={({ section }) => <Txt size="small" bold color={k.muted} style={{ paddingTop: 8 }}>{dayLabel(section.day)}</Txt>}
        renderItem={({ item }) => (
          <MessageRow message={item} meta={messageMeta(item, channels, timeOfDay(item.messageId), t)} muted={isMuted(item, notify, channels)} onPress={() => onOpen(item.messageId)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
        ListEmptyComponent={empty}
      />
      {canPostSomewhere ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', bottom: 16, left: 0, right: 0, alignItems: 'center' }}>
          <View pointerEvents="box-none" style={{ width: '100%', maxWidth: 680, paddingHorizontal: 16, alignItems: 'flex-end' }}>
            <Pressable accessibilityRole="button" onPress={onNew}
              style={{ height: 56, paddingHorizontal: 20, borderRadius: 18, flexDirection: 'row', gap: 8, backgroundColor: k.tekhelet, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 }}>
              <Icon name="plus" size={20} color={k.onAction} />
              <Txt bold color={k.onAction}>{t('messages.new')}</Txt>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
