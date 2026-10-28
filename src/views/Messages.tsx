import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, SectionList, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSession } from '../client/SessionProvider.tsx';
import { channelLabel } from '../client/channelsView.ts';
import { groupByDay, isMuted, timeOfDay, visibleList } from '../client/messageView.ts';
import { clearFilters, facetRows, mutedCount, showMutedFromStored, showMutedKey, showMutedToStored, toggleType as toggleTypeIn, typeCounts, typeSummary } from '../client/msgFilter.ts';
import { showCompose } from '../client/roleView.ts';
import { filterMessages, filterTypeChips, mergeArchive, messageMeta, showChannelChips } from '../client/typesView.ts';
import type { Message, MessageType } from '../client/types.ts';
import { israelDate } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { textStart } from '../i18n/direction.ts';
import { Button, Chip, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { fonts, TOUCH, edge, type } from '../kit/theme.ts';
import { queryWords } from '../search/normalize.ts';
import type { CachedMessage } from '../search/cache.ts';
import { MessageRow } from './MessageRow.tsx';
import { TypeFilter } from './TypeFilter.tsx';

/** Fixture entry only: 'all' opens with the muted switch on. */
export type Filter = 'mine' | 'all';

/**
 * M2 (UX §12.8): search field, channel chips (only with several channels; a chat channel's chip opens its chat), the
 * one "סוג הודעה" control (several types can be on, with counts), the muted switch inside it, messages grouped by
 * Israel day. Filters and counts run over the whole on-device archive.
 */
export function Messages({ onOpen, onChat, onNew, initialFilter, initialQuery = '' }: { onOpen: (id: string) => void; onChat: (channelId: string) => void; onNew?: () => void; initialFilter?: Filter; initialQuery?: string }) {
  const { t, lang, dir } = useI18n();
  const { width } = useWindowDimensions();
  const k = useTokens();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { state, archive: loadArchive, cacheStatus } = useSession();
  const { feed, channels, kehila, me, kehilaId } = state;
  const [showMuted, setShowMuted] = React.useState(initialFilter === 'all');
  const [channelId, setChannelId] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const [text, setText] = React.useState(initialQuery);
  const [debounced, setDebounced] = React.useState(initialQuery);
  const [types, setTypes] = React.useState<MessageType[]>([]);
  const [archive, setArchive] = React.useState<CachedMessage[]>([]);
  const [status, setStatus] = React.useState({ complete: true, count: 0 });
  const key = me && kehilaId ? showMutedKey(me.userId, kehilaId) : null;

  // The choice is remembered per Kehila on this device.
  React.useEffect(() => {
    if (!key || initialFilter) return;
    let live = true;
    AsyncStorage.getItem(key).then(v => { if (live) setShowMuted(showMutedFromStored(v)); }, () => {});
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
  // Opening the list starts following the on-device archive; the counts run over all of it.
  React.useEffect(() => {
    let live = true;
    const poll = () => cacheStatus().then(s => { if (live) setStatus(s); }, () => {});
    void poll();
    const timer = setInterval(() => { if (!status.complete) void poll(); }, 500);
    return () => { live = false; clearInterval(timer); };
  }, [cacheStatus, status.complete]);
  React.useEffect(() => {
    let live = true;
    loadArchive().then(r => { if (live) setArchive(r); }, () => { if (live) setArchive([]); });
    return () => { live = false; };
  }, [status.count, loadArchive, kehilaId]);

  if (!kehila) return null;
  const notify = kehila.notify;
  const multiChannel = showChannelChips(channels);
  const visibleTypes = filterTypeChips(kehila.role, Object.values(feed.messages));
  const selTypes = types.filter(x => (visibleTypes as MessageType[]).includes(x));
  const facet = { text: debounced, channelId, showMuted, notify, channels };
  // Every message the person may see, muted included: the feed plus the archive's older ones.
  const base = React.useMemo(
    () => mergeArchive(visibleList(feed, { mode: 'all', notify, channels }), archive.filter(c => channels.some(x => x.channelId === c.channelId))),
    [feed, archive, notify, channels]);
  const faceted = facetRows(base, facet);
  const counts = typeCounts(faceted, visibleTypes);
  const list = filterMessages(faceted, { text: '', types: selTypes });
  const active = hasText || selTypes.length > 0 || channelId !== null;
  const mutedHidden = showMuted ? 0 : mutedCount(base, facet, selTypes);
  const mutedAny = mutedCount(base, { ...facet, text: '', channelId: null }, []) > 0;
  const sections = groupByDay(list).map(g => ({ day: g.day, data: g.items }));
  const today = israelDate();
  const dayLabel = (day: string) => day === today ? t('messages.today')
    : day ? new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00+02:00`)) : '';
  const canPostSomewhere = !!onNew && showCompose(kehila.role, channels);
  // A mouse cannot drag a horizontal scroller: on wide web windows the chips wrap.
  const wrapChips = Platform.OS === 'web' && width >= 600;

  function chooseMuted(on: boolean) {
    setShowMuted(on);
    if (key) void AsyncStorage.setItem(key, showMutedToStored(on)).catch(() => {});
  }
  const clearAll = () => { const c = clearFilters({ text, types, channelId, showMuted }); setText(c.text); setDebounced(c.text); setTypes(c.types); setChannelId(c.channelId); };

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
  const typeLabel = (x: MessageType) => t(`compose.types.${x}`);
  const listText = typeSummary(selTypes, typeLabel, t);
  const typeControl = (
    <TypeFilter
      label={selTypes.length ? t('messages.type.summary', { list: listText }) : t('messages.type.control')}
      summary={selTypes.length ? undefined : `· ${t('messages.type.all')}`}
      badge={selTypes.length}
      a11y={t('messages.type.a11y', { summary: selTypes.length ? listText : t('messages.type.all'), n: list.length })}
      rows={visibleTypes.map(x => ({ type: x, label: typeLabel(x), count: counts.byType[x] ?? 0, color: edge(x, scheme) }))}
      total={counts.total} selected={selTypes} onToggle={x => setTypes(cur => toggleTypeIn(cur, x, visibleTypes))} onAll={() => setTypes([])}
      shown={list.length} showMuted={showMuted} onShowMuted={chooseMuted} mutedN={mutedCount(base, facet, [])} mutedAny={mutedAny}
      loadingN={status.complete ? null : status.count} wide={wrapChips} />
  );
  const header = (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <Txt serif size="title" accessibilityRole="header">{t('messages.title')}</Txt>
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
      {typeControl}
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
  const mutedLink = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: 8 }}>
      <Txt size="small" bold color={k.tekhelet}>{label}</Txt>
    </Pressable>
  );
  const empty = !feed.loaded ? <ActivityIndicator color={k.tekhelet} /> : (
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
      <Txt color={k.muted} style={{ textAlign: 'center' }}>{active ? t('messages.emptyFiltered') : t('messages.empty')}</Txt>
      {mutedHidden > 0 ? (
        <View style={{ alignItems: 'center' }}>
          <Txt size="small" color={k.muted} style={{ textAlign: 'center' }}>{t('messages.inMuted', { n: mutedHidden })}</Txt>
          {mutedLink(t('messages.showMuted'), () => chooseMuted(true))}
        </View>
      ) : null}
      {active ? <Button kind="secondary" title={t('messages.clearFilters')} onPress={clearAll} /> : null}
    </View>
  );
  // After the last message: where someone scrolling back notices that muted messages are hidden (or shown).
  const footer = !feed.loaded || list.length === 0 ? null : mutedHidden > 0 ? (
    <View style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 }}>
      <Icon name="belloff" size={20} color={k.muted} />
      <Txt size="small" color={k.muted} style={{ flex: 1 }}>{mutedHidden === 1 ? t('messages.mutedHiddenOne') : t('messages.mutedHidden', { n: mutedHidden })}</Txt>
      {mutedLink(t('messages.mutedShow'), () => chooseMuted(true))}
    </View>
  ) : showMuted && mutedAny ? (
    <View style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 }}>
      <Icon name="bell" size={20} color={k.muted} />
      <Txt size="small" color={k.muted} style={{ flex: 1 }}>{t('messages.mutedShown')}</Txt>
      {mutedLink(t('messages.mutedHide'), () => chooseMuted(false))}
    </View>
  ) : null;

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
        ListFooterComponent={footer}
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
