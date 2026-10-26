import React from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { messageDay, ulidTime } from '../client/messageView.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Chip, Txt, useTokens } from '../kit/components.tsx';
import { fonts, TOUCH, type } from '../kit/theme.ts';
import { textStart } from '../i18n/direction.ts';
import { queryWords, snippet } from '../search/normalize.ts';
import type { CachedMessage } from '../search/cache.ts';

/** Search over the on-phone cache only (works offline). Hebrew-normalised: niqqud, final letters and quotes are ignored. */
export function Search({ onBack, onOpen, initialQuery = '', onQuery }: { onBack: () => void; onOpen: (id: string) => void; initialQuery?: string; onQuery?: (q: string) => void }) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const { state, search, cacheStatus, openMessage } = useSession();
  const [q, setQ] = React.useState(initialQuery);
  const [channelId, setChannelId] = React.useState<string | null>(null);
  const [hits, setHits] = React.useState<CachedMessage[]>([]);
  const [status, setStatus] = React.useState({ complete: true, count: 0 });
  const [openError, setOpenError] = React.useState(false);
  const channels = state.channels;
  const nameOf = (id: string) => channels.find(c => c.channelId === id)?.name ?? '';

  // The archive fills in the background; follow its progress while it is incomplete.
  React.useEffect(() => {
    let live = true;
    const poll = () => cacheStatus().then(s => { if (live) setStatus(s); }, () => {});
    void poll();
    const timer = setInterval(() => { if (!status.complete) void poll(); }, 500);
    return () => { live = false; clearInterval(timer); };
  }, [cacheStatus, status.complete]);

  React.useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      search(q, channelId ? { channelId } : {}).then(r => { if (live) setHits(r); }, () => { if (live) setHits([]); });
    }, 120);
    return () => { live = false; clearTimeout(timer); };
  }, [q, channelId, status.count, search]);

  const words = queryWords(q);
  const dateOf = (id: string) => {
    const ms = ulidTime(id);
    return Number.isFinite(ms) ? new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms)) : messageDay(id);
  };
  async function open(id: string) {
    setOpenError(false);
    if (await openMessage(id)) onOpen(id); else setOpenError(true);
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={hits}
        keyExtractor={m => m.messageId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10, width: '100%', maxWidth: 680, alignSelf: 'center' }}
        ListHeaderComponent={(
          <View style={{ gap: 12, paddingBottom: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('search.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Txt bold color={k.tekhelet}>{dir === 'rtl' ? '›' : '‹'} {t('search.back')}</Txt>
            </Pressable>
            <Txt serif size="title" accessibilityRole="header">{t('search.title')}</Txt>
            <TextInput accessibilityLabel={t('search.placeholder')} placeholder={t('search.placeholder')} placeholderTextColor={k.muted}
              value={q} onChangeText={v => { setQ(v); onQuery?.(v); }} autoFocus returnKeyType="search"
              style={{ minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={t('messages.allChannels')} selected={channelId === null} onPress={() => setChannelId(null)} />
              {channels.map(c => (
                <Chip key={c.channelId} label={c.conversation ? `💬 ${c.name}` : c.name} selected={channelId === c.channelId} onPress={() => setChannelId(c.channelId)} />
              ))}
            </ScrollView>
            {!status.complete ? <Txt size="small" color={k.muted} accessibilityRole="alert">{t('search.loading', { n: status.count })}</Txt> : null}
            {openError ? <Txt size="small" color={k.danger} accessibilityRole="alert">{t('search.openError')}</Txt> : null}
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => void open(item.messageId)}
            style={{ backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, padding: 14, gap: 6 }}>
            <Txt size="caption" color={k.muted} numberOfLines={1}>{nameOf(item.channelId)} · {dateOf(item.messageId)}</Txt>
            {item.title ? <Txt serif size="heading" numberOfLines={1}>{item.title}</Txt> : null}
            <Txt size="small" color={k.muted}>{snippet([item.body, item.title, item.authorName, item.targetName].filter(Boolean).join(' · '), words)}</Txt>
          </Pressable>
        )}
        ListEmptyComponent={<Txt color={k.muted}>{words.length === 0 ? t('search.hint') : t('search.empty')}</Txt>}
      />
    </View>
  );
}
