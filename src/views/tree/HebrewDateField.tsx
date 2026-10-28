import { HDate } from '@hebcal/hdate';
import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Field, Txt, useTokens } from '../../kit/components.tsx';
import { fromGregorian, monthsOf } from '../../tree/dates.ts';
import { gregOf, gregText, monthName, parseGreg } from '../../tree/format.ts';
import { dateOfPart, maxDay } from '../../tree/sheet.ts';
import type { DatePart } from '../../tree/sheet.ts';
import { Select } from './Select.tsx';

const yearWord = (year: number) => { const parts = new HDate(1, 7, year).renderGematriya(true).split(' '); return parts[parts.length - 1]!; };
/** Hebrew years from the current one down (births, deaths) or a given range (the bar mitzvah picker). */
function yearOptions(current: number | undefined, range?: [number, number]) {
  const now = new HDate().getFullYear();
  const [lo, hi] = range ?? [now - 130, now];
  const years: number[] = [];
  for (let y = hi; y >= lo; y--) years.push(y);
  if (current !== undefined && !years.includes(current)) years.push(current);
  return years.map(y => ({ value: y, label: yearWord(y) }));
}

/**
 * Day, month and year selects, Hebrew first (§17.4 "Dates"). The month list is the months of the chosen year: a leap year has
 * "אדר א׳" and "אדר ב׳" and no plain "אדר". The Gregorian date is computed under it and can be typed instead (`greg`).
 */
export function HebrewDateField({ label, part, onChange, greg = true, years, testID }: {
  label: string; part: DatePart; onChange: (patch: DatePart) => void; greg?: boolean; years?: [number, number]; testID?: string;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const full = dateOfPart(part);
  const iso = full ? gregOf(full) : undefined;
  const [text, setText] = React.useState(iso ? gregText(iso) : '');
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => { if (iso) { setText(gregText(iso)); setBad(false); } }, [iso]);
  const leap = part.year !== undefined && monthsOf(part.year).includes('adar_i');
  const top = part.month ? maxDay(part.month, part.year) : 30;
  const type = (value: string) => {
    setText(value);
    const parsed = parseGreg(value);
    setBad(value.trim() !== '' && !parsed && /\d{4}$/.test(value.trim()));
    if (!parsed) return;
    const h = fromGregorian(parsed);
    onChange({ day: h.day, month: h.month, year: h.year });
  };
  return (
    <View style={{ gap: 6 }} accessibilityRole="summary" accessibilityLabel={label}>
      <Txt size="small" bold>{label}</Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Select testID={testID ? `${testID}-day` : undefined} label={t('tree.f.day')} placeholder={t('tree.f.day')} value={part.day} onChange={day => onChange({ day })}
          options={Array.from({ length: top }, (_, i) => ({ value: i + 1, label: new HDate(i + 1, 7, 5785).renderGematriya(true).split(' ')[0]! }))} />
        <Select testID={testID ? `${testID}-month` : undefined} label={t('tree.f.month')} placeholder={t('tree.f.month')} value={part.month} onChange={month => onChange({ month })}
          options={monthsOf(part.year ?? 5785).map(m => ({ value: m, label: monthName(m, part.year) }))} />
        <Select testID={testID ? `${testID}-year` : undefined} label={t('tree.f.year')} placeholder={t('tree.f.year')} value={part.year} onChange={year => onChange({ year })} options={yearOptions(part.year, years)} />
      </View>
      {leap ? <Txt size="caption" color={k.muted}>{t('tree.f.adarNote')}</Txt> : null}
      {greg ? (
        <Field label={t('tree.f.greg')} value={text} onChangeText={type} ltr keyboardType="numbers-and-punctuation" placeholder="2.12.2028"
          error={bad ? t('tree.f.gregBad') : null} testID={testID ? `${testID}-greg` : undefined} />
      ) : null}
    </View>
  );
}
