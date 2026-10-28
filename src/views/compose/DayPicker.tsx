import React from 'react';
import { hebrewDate, israelDate } from '../../dates.ts';
import { dayLabel, shortDate } from '../../client/templates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { addDays } from '../../schedule/week.ts';
import { Select } from '../admin/scheduleEditor/controls.tsx';

/** A day from today on, as a select: "ג׳, 3.11" with the Hebrew date as the hint. No native date dependency (§19.2). */
export function DayPicker({ label, value, days, onChange, error }: { label: string; value: string; days: number; onChange: (iso: string) => void; error?: boolean }) {
  const { lang } = useI18n();
  const today = israelDate();
  const options = React.useMemo(() => {
    const list = Array.from({ length: days }, (_, i) => addDays(today, i));
    if (value && !list.includes(value)) list.unshift(value);
    return list.map(iso => ({ key: iso, label: `${dayLabel(iso, lang, 'short')}, ${shortDate(iso)}`, hint: hebrewDate(iso, lang) }));
  }, [today, days, value, lang]);
  return <Select label={label} value={value || null} options={options} onChange={onChange} error={error} placeholder={label} width={undefined} />;
}
