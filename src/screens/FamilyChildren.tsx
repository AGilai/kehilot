import React, { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { newChild, PARASHA_OPTIONS, TRIBES } from '../types';
import type { Child, Tribe } from '../types';
import { Button, C, Choice, Field, s } from '../ui';
import { HebrewBirthDateFields } from './HebrewBirthDateFields';

export function FamilyChildren({ value, fatherTribe, onChange, disabled }: { value: Child[]; fatherTribe: Tribe; onChange: (children: Child[]) => void; disabled: boolean }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const fatherTribeLabel = TRIBES.find(option => option.value === fatherTribe)?.label;
  function update(id: string, patch: Partial<Child>) {
    if (!disabled) onChange(value.map(child => child.id === id ? { ...child, ...patch } : child));
  }
  function add(gender: Child['gender']) {
    if (!disabled && value.length < 30) onChange([...value, newChild(gender)]);
  }
  function gender(id: string, next: Child['gender']) {
    if (value.find(child => child.id === id)?.gender === next) return;
    update(id, next === 'daughter'
      ? { gender: next, torahName: '', barMitzvahParasha: '', barMitzvahDate: '', spousePrayerName: '', spouseTribe: '' }
      : { gender: next, spouseTorahName: '', spouseTribe: '' });
  }
  function married(id: string, next: boolean) {
    update(id, next ? { married: true } : { married: false, spouseName: '', spouseTribe: '', spouseTorahName: '', spousePrayerName: '' });
  }
  return <View style={{ gap: 16 }}>
    <View style={s.between}><Text style={s.heading}>הילדים והמשפחה</Text><Text style={s.muted}>{value.length} ילדים</Text></View>
    <Text style={s.muted}>אפשר להוסיף בנים ובנות בכל גיל, כולל ילדים נשואים. פרטי כל ילד נשמרים בנפרד ומקושרים למשפחה, כדי לאפשר לבנים מעקב עצמאי אחר עליות לתורה.</Text>
    <View style={s.row}>
      <View style={{ flex: 1 }}><Button title="+ הוספת בן" secondary disabled={disabled || value.length >= 30} onPress={() => add('son')} /></View>
      <View style={{ flex: 1 }}><Button title="+ הוספת בת" secondary disabled={disabled || value.length >= 30} onPress={() => add('daughter')} /></View>
    </View>
    {!value.length && <View style={s.card}><Text style={s.text}>כל המשפחה, במקום אחד</Text><Text style={s.muted}>שם ותאריך לידה לכל ילד, ובהמשך גם פרטי בר המצווה ובן או בת הזוג.</Text></View>}
    {value.map((child, index) => <View key={child.id} style={s.card}>
      <View style={s.between}>
        <Text style={s.heading}>{child.name || `${child.gender === 'son' ? 'בן' : 'בת'} ${index + 1}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`הסרת ${child.name || 'ילד מהפרופיל'}`} disabled={disabled} hitSlop={10} onPress={() => setRemoving(child.id)}><Text style={{ color: C.red }}>הסרה</Text></Pressable>
      </View>
      {removing === child.id && <View style={{ gap: 10 }}>
        <Text style={s.text}>להסיר מהפרופיל המשפחתי? השינוי יחול רק בשמירת הפרטים.</Text>
        <Button title="הסרה מהפרופיל" secondary disabled={disabled} onPress={() => { onChange(value.filter(item => item.id !== child.id)); setRemoving(null); }} />
        <Button title="ביטול" secondary onPress={() => setRemoving(null)} />
      </View>}
      <Choice label="בן או בת" value={child.gender} disabled={disabled} options={[{ value: 'son', label: 'בן' }, { value: 'daughter', label: 'בת' }]} onChange={next => gender(child.id, next)} />
      <Field label="שם הילד/ה *" value={child.name} maxLength={200} editable={!disabled} onChangeText={name => update(child.id, { name })} />
      {child.gender === 'son' && <Text style={s.muted}>מעמד הבן: {fatherTribeLabel ? `${fatherTribeLabel} · כמו האב` : 'יש לבחור תחילה את מעמד האב'}</Text>}
      <HebrewBirthDateFields value={child.hebrewBirthDate} onChange={hebrewBirthDate => update(child.id, { hebrewBirthDate })} disabled={disabled} required={!child.birthDate} />
      {child.gender === 'son' && <>
        <View style={s.separator} />
        <Text style={s.heading}>עלייה לתורה ובר מצווה</Text>
        <Field label="שם הבן לעלייה לתורה" value={child.torahName} maxLength={200} editable={!disabled} placeholder="למשל: יעקב בן ישראל" onChangeText={torahName => update(child.id, { torahName })} />
        <Choice label="פרשת שבת בר המצווה" value={child.barMitzvahParasha} disabled={disabled} options={PARASHA_OPTIONS} onChange={barMitzvahParasha => update(child.id, { barMitzvahParasha })} />
        <Field label="תאריך שבת בר המצווה (רשות)" value={child.barMitzvahDate} maxLength={10} editable={!disabled} autoCorrect={false} placeholder="YYYY-MM-DD" style={{ writingDirection: 'ltr' }} onChangeText={barMitzvahDate => update(child.id, { barMitzvahDate })} hint="ממלאים כשהפרשה או תאריך השבת ידועים. תאריך השבת מוזן בנפרד מתאריך הלידה." />
      </>}
      <View style={s.separator} />
      <View style={s.between}><Text style={[s.text, { fontWeight: '600' }]}>{child.gender === 'son' ? 'נשוי' : 'נשואה'}</Text><Switch accessibilityLabel={`${child.name || 'הילד/ה'} נשוי/אה`} value={child.married} disabled={disabled} onValueChange={next => married(child.id, next)} trackColor={{ false: '#D9DED6', true: C.green }} thumbColor="#FFFFFF" /></View>
      {child.married && <>
        <Field label={child.gender === 'son' ? 'שם בת הזוג' : 'שם בן הזוג'} value={child.spouseName} maxLength={200} editable={!disabled} onChangeText={spouseName => update(child.id, { spouseName })} />
        {child.gender === 'daughter' && <Choice label="החתן: כהן, לוי או ישראל *" value={child.spouseTribe} options={TRIBES} disabled={disabled} onChange={spouseTribe => update(child.id, { spouseTribe })} />}
        {child.gender === 'son'
          ? <Field label="שם בת הזוג למי שברך" value={child.spousePrayerName} maxLength={200} editable={!disabled} placeholder="השם ושם האב" onChangeText={spousePrayerName => update(child.id, { spousePrayerName })} />
          : <Field label="שם בן הזוג לעלייה לתורה" value={child.spouseTorahName} maxLength={200} editable={!disabled} placeholder="השם ושם האב" onChangeText={spouseTorahName => update(child.id, { spouseTorahName })} />}
      </>}
    </View>)}
  </View>;
}
