import React from 'react';
import { Pressable, View } from 'react-native';
import { fixtureNow } from '../client/fixtures.ts';
import { config } from '../config.ts';
import { clockTime, israelDate } from '../dates.ts';
import { useSchedule } from '../client/useSchedule.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { BackIcon, ForwardIcon } from '../kit/Icon.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { candleRowTime, clockLabel, dateRange, fullModel, hasTimedRows, isDefaultPlace, shortDate, textIn } from '../schedule/memberView.ts';
import { israelNow } from '../schedule/week.ts';
import { zmanimForLocation } from '../schedule/zmanim.ts';
import type { ComputedRow } from '../schedule/types.ts';
import { CandleLine, useCountdownText, useShabbatTitle } from './ScheduleCard.tsx';
import { ScheduleRow } from './ScheduleRow.tsx';

/** P22: every section of the saved schedule for the current or the next schedule week, with this week's changes. Print is Task 4 (a toast for now). */
export function Schedule({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { state, retry } = useSchedule();
  const [now, setNow] = React.useState(() => fixtureNow() ?? new Date());
  const [weekIndex, setWeekIndex] = React.useState<0 | 1>(0);
  React.useEffect(() => {
    if (config.fixtures && fixtureNow()) return;
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const title = useShabbatTitle();
  const counting = useCountdownText();
  const doc = state.status === 'ready' ? state.doc : null;
  const zmanimFor = React.useMemo(() => zmanimForLocation(doc?.location), [doc]);
  const model = React.useMemo(() => (doc && hasTimedRows(doc) ? fullModel(doc, israelNow(now), zmanimFor, weekIndex) : null), [doc, now, zmanimFor, weekIndex]);

  const heading = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Txt serif size="display" accessibilityRole="header" style={{ flex: 1 }}>{t('schedule.title')}</Txt>
      <Button kind="secondary" icon="print" title={t('schedule.print')} accessibilityLabel={t('schedule.printA11y')} onPress={() => onToast(t('schedule.soon'))} />
    </View>
  );
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('schedule.back')} onPress={onBack} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('schedule.back')}</Txt></View>
    </Pressable>
  );
  const arrow = (dir: 0 | 1, enabled: boolean, label: string, icon: React.ReactNode) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={() => setWeekIndex(dir)}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.35 }}>{icon}</Pressable>
  );

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      {back}
      {heading}
      {state.status === 'loading' ? <Card><Txt color={k.muted}>{t('common.loading')}</Txt></Card> : null}
      {state.status === 'error' ? <Banner tone="error" text={t('schedule.error')} action={{ title: t('common.retry'), onPress: retry }} /> : null}
      {state.status === 'ready' && state.cachedAt !== null ? <Banner text={t('schedule.offline', { time: clockLabel(clockTime(new Date(state.cachedAt).toISOString())) })} /> : null}
      {doc && !model ? <Card><Txt color={k.muted}>{t('schedule.empty')}</Txt></Card> : null}
      {doc && model ? (
        <>
          <View accessibilityRole="toolbar" accessibilityLabel={t('schedule.week')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48 }}>
            {arrow(0, weekIndex === 1, t('schedule.weekPrev'), <BackIcon color={k.tekhelet} />)}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Txt bold style={{ textAlign: 'center' }}>{title(model.week)}</Txt>
              <Txt size="caption" color={k.muted} style={{ textAlign: 'center' }}>{dateRange(model.week.friday, model.week.thursday)}{weekIndex === 0 ? ` · ${t('schedule.thisWeek')}` : ''}</Txt>
            </View>
            {arrow(1, weekIndex === 0, t('schedule.weekNext'), <ForwardIcon color={k.tekhelet} />)}
          </View>
          {model.sections.map(section => {
            const shabbat = section.kind === 'shabbat';
            const days = shabbat ? `${t('schedule.daysShabbat')} · ${dateRange(model.week.friday, model.week.shabbat, true)}` : `${t('schedule.daysWeekday')} · ${dateRange(model.week.weekdays[0]!, model.week.weekdays[4]!)}`;
            const rows = section.rows.filter((row: ComputedRow) => row.role !== 'candles');
            return (
              <Card key={section.id} edgeColor={shabbat ? k.gold : k.tekhelet}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <Txt serif size="heading" accessibilityRole="header">{textIn(section.title, lang)}</Txt>
                  <Txt size="caption" color={k.muted}>{days}</Txt>
                </View>
                {shabbat ? <CandleLine doc={doc} week={model.week} fallback={candleRowTime(model.computed)} border={false} /> : null}
                <View>
                  {rows.map((row, i) => {
                    const isNext = model.next?.rowId === row.id;
                    const countText = isNext ? counting(model.next!.countdown) : null;
                    return (
                      <ScheduleRow key={row.id} row={row} first={i === 0 && !shabbat} next={isNext} past={model.past.has(row.id)}
                        nextCaption={isNext ? [t('schedule.nextShort'), countText].filter(Boolean).join(' · ') : undefined} />
                    );
                  })}
                </View>
                {section.hidden.length ? <Txt size="caption" color={k.muted}>{t('schedule.notThisWeek', { list: section.hidden.map(row => textIn(row.label, lang)).join(', ') })}</Txt> : null}
              </Card>
            );
          })}
          <Txt size="caption" color={k.muted}>
            {t('schedule.updated', { city: isDefaultPlace(doc.location) ? t('home.petahTikva') : t('schedule.cityFallback'), date: doc.updatedAt ? shortDate(israelDate(new Date(doc.updatedAt))) : '' })}
          </Txt>
        </>
      ) : null}
    </PadScroll>
  );
}
