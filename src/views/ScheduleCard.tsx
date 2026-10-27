import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Card, Txt, useTokens } from '../kit/components.tsx';
import { ForwardIcon, Icon } from '../kit/Icon.tsx';
import { civilDate, clockTime, hebrewDate } from '../dates.ts';
import { candleLine, clockLabel, countdownText, shortDate, textIn } from '../schedule/memberView.ts';
import type { CardModel, Countdown } from '../schedule/memberView.ts';
import { parashaOf } from '../schedule/parasha.ts';
import type { ScheduleDoc, ScheduleWeek } from '../schedule/types.ts';
import { ScheduleRow } from './ScheduleRow.tsx';

const time: { fontVariant: ['tabular-nums'] } = { fontVariant: ['tabular-nums'] };

/** "Shabbat Vayera" (or just "Shabbat" on a holiday Shabbat with no regular reading). */
export function useShabbatTitle(): (week: ScheduleWeek) => string {
  const { t, lang } = useI18n();
  return week => {
    const parasha = parashaOf(week.shabbat, lang);
    return parasha ? t('schedule.shabbatOf', { parasha }) : t('schedule.shabbatPlain');
  };
}

export function useCountdownText(): (c: Countdown | null) => string | null {
  const { t } = useI18n();
  return c => { if (!c) return null; const { key, params } = countdownText(c); return t(key, params); };
}

export function dayName(date: string, lang: 'he' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' }).format(civilDate(date));
}

/** Candle lighting for the sheet's cities ("Jerusalem 16:13 · Tel Aviv 16:33") or the Kehila's own time: the flame line of P21/P22. */
export function CandleLine({ doc, week, fallback, label, border = true }: { doc: ScheduleDoc; week: ScheduleWeek; fallback: string | null; label?: string; border?: boolean }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const entries = candleLine(doc, week, fallback);
  if (!entries.length) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderTopWidth: border ? 1 : 0, borderTopColor: k.line, paddingTop: 4 }}>
      <Icon name="flame" size={20} color={k.gold} />
      <Txt style={{ flexShrink: 0 }}>{label ?? t('schedule.candles')}</Txt>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt size="small">
          {entries.map((entry, i) => (
            <Txt key={i} size="small">{i > 0 ? ' · ' : ''}{entry.name ? `${textIn(entry.name, lang)} ` : ''}<Txt size="small" bold style={time}>{clockLabel(entry.time)}</Txt></Txt>
          ))}
        </Txt>
      </View>
    </View>
  );
}

/** P21: the Kehila's schedule on Home. Shabbat mode from Thursday, weekday mode otherwise (the mode logic is memberView.ts). */
export function ScheduleCard({ model, doc, cachedAt, onFull }: { model: CardModel; doc: ScheduleDoc; /** The copy on this device is shown (offline): when it was saved. */ cachedAt: number | null; onFull: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const title = useShabbatTitle();
  const counting = useCountdownText();
  const shabbat = model.mode === 'shabbat';
  const { next } = model;
  const nextLabel = shabbat && next && next.dayOffset === 0 && next.section.kind === 'weekday' ? t('schedule.nextToday') : t('schedule.next');
  const overline = model.header === 'shabbat' ? t('schedule.title') : model.header === 'today' ? t('schedule.today') : t('schedule.tomorrow');
  const changed = !!next && next.row.source === 'override' && !next.row.added;
  const countText = next ? counting(next.countdown) : null;
  const caption = !next ? null : model.header === 'tomorrow' ? t('schedule.tomorrowDay', { day: dayName(next.date, lang) })
    : [changed && next.row.usual ? t('schedule.usually', { time: clockLabel(next.row.usual) }) : null, countText].filter(Boolean).join(' · ') || null;
  const edge = shabbat ? k.gold : k.tekhelet;
  const date = model.week.shabbat;
  const hebrew = hebrewDate(date, lang).split(' ').slice(0, -1).join(' ');
  return (
    <Card edgeColor={edge}>
      <View accessible accessibilityRole="header" accessibilityLabel={shabbat ? `${overline}. ${title(model.week)}` : overline}>
        <Txt size="caption" bold color={k.muted}>{overline}</Txt>
      </View>
      {cachedAt !== null ? <Banner text={t('schedule.offline', { time: clockLabel(clockTime(new Date(cachedAt).toISOString())) })} /> : null}
      {shabbat ? (
        <View>
          <Txt serif size="heading">{title(model.week)}</Txt>
          <Txt size="small" color={k.muted}>{hebrew} · <Txt size="small" color={k.muted} style={time}>{shortDate(date)}</Txt></Txt>
        </View>
      ) : null}
      {shabbat ? <CandleLine doc={doc} week={model.week} fallback={model.candles} /> : null}
      {next ? (
        <View style={{ borderWidth: 2, borderColor: k.tekhelet, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size="caption" bold color={k.tekhelet}>{nextLabel}</Txt>
            <Txt bold size="heading">{textIn(next.row.label, lang)}</Txt>
            {caption ? <Txt size="caption" color={k.muted}>{caption}</Txt> : null}
          </View>
          <Txt size="display" color={k.tekhelet} style={time}>{clockLabel(next.time)}</Txt>
        </View>
      ) : null}
      {model.following.map((item, i) => (
        <ScheduleRow key={`${item.date}-${item.row.id}`} row={item.row} compact first={i === 0 && !next}
          suffix={shabbat && item.today && item.section.kind === 'weekday' ? t('schedule.todaySuffix') : undefined} />
      ))}
      {!shabbat && model.candles ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderTopWidth: 1, borderTopColor: k.line, paddingTop: 4 }}>
          <Icon name="flame" size={20} color={k.gold} />
          <Txt style={{ flex: 1 }}>{parashaOf(model.week.shabbat, lang) ? t('schedule.candlesFriday', { parasha: parashaOf(model.week.shabbat, lang)! }) : t('schedule.candlesFridayPlain')}</Txt>
          <Txt bold style={time}>{clockLabel(model.candles)}</Txt>
        </View>
      ) : null}
      <Pressable accessibilityRole="link" onPress={onFull} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Txt bold color={k.tekhelet}>{t('schedule.full')}</Txt>
        <ForwardIcon color={k.tekhelet} />
      </Pressable>
    </Card>
  );
}

/** Quiet placeholder while the schedule loads (UX §14.3 states). */
export function ScheduleSkeleton() {
  const k = useTokens();
  const bar = (w: string, h: number) => <View style={{ width: w as `${number}%`, height: h, borderRadius: 6, backgroundColor: k.line }} />;
  return <Card edgeColor={k.line}><View accessible accessibilityLabel="" style={{ gap: 10 }}>{bar('35%', 12)}{bar('60%', 22)}{bar('100%', 56)}{bar('80%', 14)}</View></Card>;
}
