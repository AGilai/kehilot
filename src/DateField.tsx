import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { dayOfWeek, formatCivilDate, israelDate, pickerDate, pickerDateISO, validCivilDate } from './dates';
import { Button, C, ErrorText, s } from './ui';

export type DateFieldProps = {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
  optional?: boolean; hint?: string; minimumDate?: string; maximumDate?: string; weekday?: number;
};

export function DateField({ label, value, onChange, disabled = false, optional = false, hint, minimumDate, maximumDate, weekday }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  function choose(next: string) {
    if (disabled) return;
    if (!validCivilDate(next, true) || (minimumDate && next < minimumDate) || (maximumDate && next > maximumDate)) {
      setError('יש לבחור תאריך בטווח המותר.'); return;
    }
    if (weekday !== undefined && dayOfWeek(next) !== weekday) { setError('יש לבחור תאריך של שבת.'); return; }
    setError(null); onChange(next); setOpen(false);
  }
  function show() {
    setError(null);
    let initial = validCivilDate(value, true) ? value : israelDate();
    if (minimumDate && initial < minimumDate) initial = minimumDate;
    if (maximumDate && initial > maximumDate) initial = maximumDate;
    setDraft(initial);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerDate(initial), mode: 'date', display: 'calendar',
        minimumDate: minimumDate ? pickerDate(minimumDate) : undefined,
        maximumDate: maximumDate ? pickerDate(maximumDate) : undefined,
        positiveButton: { label: 'בחירה', textColor: C.green }, negativeButton: { label: 'ביטול' },
        neutralButton: optional ? { label: 'ניקוי' } : undefined,
        onValueChange: (_event, next) => choose(pickerDateISO(next)),
        onNeutralButtonPress: () => { if (optional && !disabled) onChange(''); },
        onError: () => setError('לא ניתן לפתוח את לוח השנה. יש לנסות שוב.'),
      });
    } else setOpen(true);
  }
  return <View>
    <Text style={s.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: formatCivilDate(value) || 'לא נבחר תאריך' }} accessibilityState={{ disabled }} disabled={disabled} onPress={show} style={[s.input, s.between, disabled && { opacity: 0.6 }]}>
      <Text style={[s.text, { writingDirection: 'ltr', color: value ? C.ink : C.muted }]}>{formatCivilDate(value) || 'DD-MM-YYYY'}</Text>
      <Text style={s.muted}>▦</Text>
    </Pressable>
    {hint && <Text style={s.muted}>{hint}</Text>}
    {!open && <ErrorText error={error} />}
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
        <Text style={s.heading}>{label}</Text>
        <Text style={[s.text, { writingDirection: 'ltr' }]}>{formatCivilDate(draft)}</Text>
        {open && <DateTimePicker value={pickerDate(draft)} mode="date" display="inline" locale="he-IL" themeVariant="light" accentColor={C.green}
          style={{ alignSelf: 'stretch', height: 380 }}
          minimumDate={minimumDate ? pickerDate(minimumDate) : undefined} maximumDate={maximumDate ? pickerDate(maximumDate) : undefined}
          onValueChange={(_event, next) => { setDraft(pickerDateISO(next)); setError(null); }} />}
        <ErrorText error={error} />
        <Button title="בחירת התאריך" disabled={disabled} onPress={() => choose(draft)} />
        {optional && <Button title="ניקוי התאריך" secondary disabled={disabled} onPress={() => { onChange(''); setOpen(false); }} />}
        <Button title="ביטול" secondary onPress={() => setOpen(false)} />
      </ScrollView></SafeAreaView>
    </Modal>
  </View>;
}
