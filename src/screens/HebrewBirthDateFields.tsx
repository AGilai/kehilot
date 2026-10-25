import React, { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type { HebrewBirthDate } from '../types';
import { birthDayOptions, birthMonthOptions, birthYearOptions, updateHebrewBirthDate } from '../dates';
import { Choice, s } from '../ui';

export function HebrewBirthDateFields({ value, onChange, disabled, required = false }: {
  value: HebrewBirthDate | null;
  onChange: (value: HebrewBirthDate | null) => void;
  disabled: boolean;
  required?: boolean;
}) {
  const day = value?.day ? String(value.day) : '';
  const month = value?.month ?? '';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 60000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  return <View style={{ gap: 8 }}>
    <Text style={s.label}>תאריך לידה עברי{required ? ' *' : ' (רשות)'}</Text>
    <Choice label="שנת הלידה" value={value?.year ? String(value.year) : ''} options={[{ value: '', label: 'בחירת שנה' }, ...birthYearOptions(now)]} disabled={disabled} onChange={year => onChange(updateHebrewBirthDate(value, { year: year ? Number(year) : null }))} />
    <View style={[s.row, { alignItems: 'flex-start' }]}>
      <View style={{ flex: 1 }}><Choice label="יום הלידה" value={day} options={[{ value: '', label: 'בחירת יום' }, ...birthDayOptions(month, value?.year)]} disabled={disabled} onChange={next => onChange(updateHebrewBirthDate(value, { day: Number(next) }))} /></View>
      <View style={{ flex: 1 }}><Choice<HebrewBirthDate['month']> label="חודש הלידה" value={month} options={[{ value: '', label: 'בחירת חודש' }, ...birthMonthOptions(value?.year)]} disabled={disabled} onChange={next => onChange(updateHebrewBirthDate(value, { month: next }))} /></View>
    </View>
    <Text style={s.muted}>בחרו שנה, חודש ויום. חודשי אדר ומספר הימים מותאמים לשנה שנבחרה.</Text>
  </View>;
}
