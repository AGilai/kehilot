import React, { useState } from 'react';
import { View } from 'react-native';
import { useCommunity } from '../state';
import { CLASSIFICATION_OPTIONS } from '../types';
import { Button, Choice, ErrorText, Field } from '../ui';

export function ClassificationFields({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const { data, addClassification } = useCommunity();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = [...(data?.classifications?.length ? data.classifications : CLASSIFICATION_OPTIONS)];
  if (value && !options.some(option => option.value === value)) options.push({ value, label: value });
  async function add() {
    setBusy(true); setError(null);
    try {
      const created = await addClassification(name);
      onChange(created.value); setAdding(false); setName('');
    } catch (e) { setError(e instanceof Error ? e.message : 'הוספת הסיווג נכשלה.'); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <Choice label="סיווג המתפלל" value={value} options={[{ value: '', label: 'בחירת סיווג' }, ...options]} disabled={disabled || busy} onChange={onChange} />
    {!adding ? <Button title="+ הוספת סיווג חדש" secondary disabled={disabled || busy} onPress={() => { setAdding(true); setError(null); }} /> : <>
      <Field label="שם הסיווג החדש" value={name} onChangeText={setName} maxLength={60} autoCorrect={false} editable={!disabled && !busy} />
      <Button title="שמירת הסיווג החדש" busy={busy} disabled={disabled || !name.trim()} onPress={() => void add()} />
      <Button title="ביטול הוספת סיווג" secondary disabled={busy} onPress={() => { setAdding(false); setName(''); setError(null); }} />
    </>}
    <ErrorText error={error} />
  </View>;
}
