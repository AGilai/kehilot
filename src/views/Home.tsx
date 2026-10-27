import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadShabbat, loadZmanim } from '../api.ts';
import { useAuth } from '../auth/AuthProvider.tsx';
import { fixtureShabbat, fixtureZmanim } from '../client/fixtures.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { visibleList } from '../client/messageView.ts';
import { config } from '../config.ts';
import { clockTime, dayOfWeek, displayDate, hebrewDate, israelDate, upcomingFriday } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Tag, Txt, useTokens } from '../kit/components.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { TOUCH } from '../kit/theme.ts';
import type { Shabbat, Zmanim } from '../types.ts';
import { isCurrentZmanim, ZMANIM_CACHE_PREFIX } from '../zmanim.ts';
import { roleFeatures } from '../client/roleView.ts';
import { HomeCards } from './HomeCards.tsx';
import { TestBuildCard } from './TestBuildCard.tsx';
import { SeatCard } from './SeatCard.tsx';
import { previewCardState, previewMemberSeats } from '../seats/preview.ts';
import { cardWindow, shabbatFriday, whenParts } from '../seats/window.ts';
import { LockedRows, MembershipCard } from './GuestHome.tsx';
import { Stripe } from './MessageRow.tsx';
import { ForwardIcon, Icon } from '../kit/Icon.tsx';

const TIMES = ['sunrise', 'sofZmanShma', 'sofZmanTfilla', 'minchaGedola', 'plagHaMincha', 'sunset', 'nightfall'] as const;

const loaders = config.fixtures
  ? { zmanim: async (d: string) => fixtureZmanim(d), shabbat: async (d: string) => fixtureShabbat(upcomingFriday(d)) }
  : { zmanim: loadZmanim, shabbat: loadShabbat };

/** M1 (the day arc comes later): greeting, dates, zmanim grid, Shabbat card, and the latest three titles. */
export function Home({ onOpen, onMessages, onPhoneList, onTerms, onToast, onSeats }: { onOpen: (id: string) => void; onMessages: () => void; /** Members and gabbaim only. */ onPhoneList?: () => void; /** The terms card's button (management mode until the terms gate exists). */ onTerms?: () => void; onToast?: (text: string) => void; /** The seat-release preview (UX §15): opens the seat page. */ onSeats?: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { signOut } = useAuth();
  const { state } = useSession();
  const [now, setNow] = React.useState(new Date());
  const date = israelDate(now);
  const [zmanim, setZmanim] = React.useState<Zmanim | null>(null);
  const [shabbat, setShabbat] = React.useState<Shabbat | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [shabbatError, setShabbatError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [cached, setCached] = React.useState(false);

  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    let active = true;
    setBusy(true); setNote(null); setShabbatError(false); setZmanim(null); setShabbat(null); setCached(false);
    (async () => {
      try {
        const fresh = await loaders.zmanim(date);
        if (active) setZmanim(fresh);
        await AsyncStorage.setItem(`${ZMANIM_CACHE_PREFIX}.${date}`, JSON.stringify(fresh)).catch(() => {});
      } catch {
        const raw = await AsyncStorage.getItem(`${ZMANIM_CACHE_PREFIX}.${date}`).catch(() => null);
        if (!active) return;
        let valid = false;
        try {
          const saved = raw ? JSON.parse(raw) : null;
          if (isCurrentZmanim(saved, date)) { setZmanim(saved); setCached(true); valid = true; }
        } catch { /* never show another day's times or a corrupt cache */ }
        setNote(valid ? t('home.offlineNote') : t('home.zmanimError'));
      } finally { if (active) setBusy(false); }
    })();
    loaders.shabbat(date).then(v => { if (active) setShabbat(v); }, () => { if (active) setShabbatError(true); });
    return () => { active = false; };
  }, [date, revision, t]);

  const seatPreview = React.useMemo(() => (config.seatsPreview ? previewMemberSeats() : null), []);
  const kehila = state.kehila;
  if (!kehila) return null;
  const today = zmanim?.date === date ? zmanim : null;
  const next = today ? TIMES.find(key => new Date(today.times[key] || '').getTime() > now.getTime()) : undefined;
  const latest = visibleList(state.feed, { mode: 'mine', notify: kehila.notify, channels: state.channels }).filter(m => m.type !== 'chat').slice(0, 3);
  const first = state.me?.profile?.firstName?.trim();
  const guest = roleFeatures(kehila.role).membershipCard;

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Txt size="small" color={k.muted} style={{ flexShrink: 1 }}>{displayDate(date, lang)} · {hebrewDate(date, lang)}</Txt>
          {config.testBuild ? <Tag label={t('testBuild.tag', { version: String(config.buildNumber) })} /> : null}
        </View>
        <Txt serif size="display" accessibilityRole="header">{first ? t('home.greeting', { name: first }) : t('home.greetingAnon')}</Txt>
      </View>

      <TestBuildCard />

      {seatPreview && onSeats && seatPreview.seatCount > 0 ? (
        <SeatCard count={seatPreview.seatCount} state={seatPreview.source === 'gabbai' ? 'byGabbai' : previewCardState()} deadline={whenParts(cardWindow(shabbatFriday(now)).closesAt, lang)}
          onYes={() => onToast?.(t('seats.previewToast'))} onUpdate={onSeats} />
      ) : null}

      {onToast ? <HomeCards onTerms={onTerms ?? (() => {})} onToast={onToast} /> : null}

      <Card>
        <Txt bold>{t('home.zmanimTitle')}</Txt>
        {busy && !today ? <ActivityIndicator color={k.tekhelet} /> : null}
        {next && today ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexShrink: 1 }}>
              <Txt bold size="heading">{t(`zmanim.${next}`)}</Txt>
              <Txt size="caption" color={k.muted}>{cached ? t('home.nextCached') : t('home.next')}</Txt>
            </View>
            <Txt size="display" color={k.tekhelet} style={{ fontVariant: ['tabular-nums'] }}>{clockTime(today.times[next])}</Txt>
          </View>
        ) : null}
        {TIMES.map((key, i) => (
          <View key={key} style={{ minHeight: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: i === 0 ? 0 : 1, borderTopColor: k.line }}>
            <Txt bold={next === key} color={next === key ? k.tekhelet : k.ink}>{t(`zmanim.${key}`)}</Txt>
            <Txt bold={next === key} style={{ fontVariant: ['tabular-nums'] }}>{clockTime(today?.times[key])}</Txt>
          </View>
        ))}
        {note ? <Banner tone={cached ? 'info' : 'error'} text={note} action={cached ? undefined : { title: t('common.retry'), onPress: () => setRevision(n => n + 1) }} /> : null}
      </Card>

      <Card edgeColor={k.gold}>
        <Txt bold size="heading">{dayOfWeek(date) === 5 ? t('home.shabbatToday') : t('home.shabbat')}</Txt>
        {shabbat ? <Txt size="small" color={k.muted}>{shabbat.parasha} · {displayDate(shabbat.friday, lang)}</Txt> : shabbatError ? null : <ActivityIndicator color={k.gold} />}
        {shabbat ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt>{t('home.petahTikva')} · {t('home.candles')}</Txt><Txt bold style={{ fontVariant: ['tabular-nums'] }}>{clockTime(shabbat.petahTikva)}</Txt></View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt>{t('home.telAviv')} · {t('home.candles')}</Txt><Txt bold style={{ fontVariant: ['tabular-nums'] }}>{clockTime(shabbat.telAviv)}</Txt></View>
          </>
        ) : null}
        {shabbatError ? <Banner tone="error" text={t('home.shabbatError')} action={{ title: t('common.retry'), onPress: () => setRevision(n => n + 1) }} /> : null}
      </Card>

      {onPhoneList && roleFeatures(kehila.role).phoneList ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('home.phoneList')}. ${t('home.phoneListSub')}`} onPress={onPhoneList}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="phone" size={24} color={k.tekhelet} />
            <View style={{ flex: 1 }}>
              <Txt bold>{t('home.phoneList')}</Txt>
              <Txt size="small" color={k.muted}>{t('home.phoneListSub')}</Txt>
            </View>
            <ForwardIcon color={k.tekhelet} />
          </Card>
        </Pressable>
      ) : null}

      {guest ? <MembershipCard /> : null}

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt bold size="heading">{t('home.latest')}</Txt>
          <Pressable accessibilityRole="button" onPress={onMessages} style={{ minHeight: TOUCH, justifyContent: 'center' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Txt bold color={k.tekhelet}>{t('home.allMessages')}</Txt><ForwardIcon color={k.tekhelet} /></View></Pressable>
        </View>
        {latest.length === 0 ? <Txt color={k.muted}>{t('home.noMessages')}</Txt> : null}
        {latest.map(m => (
          // Titles only: no body, no replies.
          <Pressable key={m.messageId} accessibilityRole="button" onPress={() => onOpen(m.messageId)}
            style={{ minHeight: TOUCH, flexDirection: 'row', backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, overflow: 'hidden' }}>
            <Stripe type={m.type} />
            <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}><Txt content serif numberOfLines={2}>{m.title}</Txt></View>
          </Pressable>
        ))}
      </View>

      {guest ? <LockedRows /> : null}

      <Button kind="secondary" title={t('home.signOut')} onPress={() => void signOut()} />
    </PadScroll>
  );
}
