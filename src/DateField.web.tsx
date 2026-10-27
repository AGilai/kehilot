import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { DateFieldProps } from './DateField';
import { dayOfWeek, formatCivilDate, validCivilDate } from './dates';
import { C, ErrorText, s } from './ui';

export function DateField({ label, value, onChange, disabled = false, optional = false, hint, minimumDate, maximumDate, weekday }: DateFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  function show() {
    setError(null);
    if (input.current?.showPicker) input.current.showPicker();
    else input.current?.click();
  }
  return <View>
    <Text style={s.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: formatCivilDate(value) || 'לא נבחר תאריך' }} accessibilityState={{ disabled }} disabled={disabled} onPress={show} style={[s.input, s.between]}>
      <Text style={[s.text, { writingDirection: 'ltr', color: value ? C.ink : C.muted }]}>{formatCivilDate(value) || 'DD-MM-YYYY'}</Text><Text style={s.muted}>▦</Text>
    </Pressable>
    <input ref={input} type="date" lang="en-GB" tabIndex={-1} aria-hidden="true" value={value} min={minimumDate} max={maximumDate} disabled={disabled}
      style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      onChange={event => {
        const next = event.currentTarget.value;
        if (!validCivilDate(next, true)) return;
        if (weekday !== undefined && dayOfWeek(next) !== weekday) { setError('יש לבחור תאריך של שבת.'); return; }
        setError(null); onChange(next);
      }} />
    {optional && value && <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { setError(null); onChange(''); }}><Text style={[s.text, { color: C.green }]}>ניקוי התאריך</Text></Pressable>}
    {hint && <Text style={s.muted}>{hint}</Text>}<ErrorText error={error} />
  </View>;
}
