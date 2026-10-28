// Week picker (UX-DESIGN §14.2): previous / current ▾ / next. Weeks are named by their parasha; a week with a clock change and a week
// with "this week only" edits are marked in the list.
import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Tag } from '../../../kit/components.tsx';
import { dateRange } from '../../../schedule/memberView.ts';
import type { WeekItem } from '../../../schedule/editor.ts';
import { useShabbatTitle } from '../../ScheduleCard.tsx';
import { IconBtn, Select } from './controls.tsx';

export function WeekPicker({ weeks, friday, changes, onSelect, wide }: { weeks: WeekItem[]; friday: string; changes: Record<string, number>; onSelect: (friday: string) => void; wide: boolean }) {
  const { t, dir, lang } = useI18n();
  const title = useShabbatTitle();
  const index = Math.max(0, weeks.findIndex(w => w.friday === friday));
  const current = weeks[index]!;
  const head = (w: WeekItem) => title({ friday: w.friday, shabbat: w.shabbat, weekdays: [], thursday: w.thursday });
  const options = weeks.map(w => ({
    key: w.friday, label: head(w), side: dateRange(w.friday, w.thursday, lang),
    hint: [w.upcoming ? t('editor.upcoming') : '', w.clockChange ? t(w.clockChange === 'winter' ? 'editor.clockWinter' : 'editor.clockSummer') : '', changes[w.friday] ? t('editor.weekChangesList', { n: changes[w.friday]! }) : ''].filter(Boolean).join(' · ') || undefined,
  }));
  const prev = dir === 'rtl' ? 'back' : 'fwd';
  const next = dir === 'rtl' ? 'fwd' : 'back';
  return (
    <View accessibilityRole="toolbar" accessibilityLabel={t('schedule.week')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: wide ? 'nowrap' : 'wrap' }}>
      <IconBtn icon={prev} label={t('editor.weekPrev')} disabled={index === 0} onPress={() => onSelect(weeks[index - 1]!.friday)} />
      <Select label={t('schedule.week')} value={friday} options={options} width={wide ? 300 : 230} icon="cal" onChange={onSelect}
        display={`${head(current)} · ${dateRange(current.friday, current.thursday, lang)}`} />
      <IconBtn icon={next} label={t('editor.weekNext')} disabled={index === weeks.length - 1} onPress={() => onSelect(weeks[index + 1]!.friday)} />
      {current.upcoming ? <Tag label={t('editor.upcoming')} tone="strong" /> : null}
      {current.clockChange ? <Tag label={t('editor.dstWeek')} /> : null}
    </View>
  );
}
