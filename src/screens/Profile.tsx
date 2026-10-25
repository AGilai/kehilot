import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useCommunity } from '../state';
import { MONTHS, normalizeProfile, PARASHA_OPTIONS, Profile as MemberProfile, RELATIONSHIPS, TRIBES, Yahrzeit } from '../types';
import { Button, C, Choice, ErrorText, Field, s } from '../ui';
import { FamilyChildren } from './FamilyChildren';
import { HebrewBirthDateFields } from './HebrewBirthDateFields';
import { birthDayOptions } from '../dates';

export function Profile() {
  const { data, saveProfile, isDemo } = useCommunity();
  const [draft, setDraft] = useState<MemberProfile>(() => normalizeProfile(JSON.parse(JSON.stringify(data!.profile))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saved, setSaved] = useState(() => JSON.stringify(normalizeProfile(data!.profile)));
  const dirty = JSON.stringify(draft) !== saved;
  function change<K extends keyof MemberProfile>(key: K, value: MemberProfile[K]) { setDraft(d => ({ ...d, [key]: value })); setSuccess(false); }
  function updateYahrzeit(id: string, patch: Partial<Yahrzeit>) { change('yahrzeits', draft.yahrzeits.map(y => y.id === id ? { ...y, ...patch } : y)); }
  function add() { if (busy || draft.yahrzeits.length >= 30) return; change('yahrzeits', [...draft.yahrzeits, { id: `y-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: '', relationship: 'father', day: 1, month: 'tishrei', year: '' }]); }
  async function save() {
    setBusy(true); setError(null); setSuccess(false);
    const normalized = {
      ...draft, firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), name: `${draft.firstName.trim()} ${draft.lastName.trim()}`.trim(), phone: draft.phone.trim(), wifePhone: draft.wifePhone.trim(),
      torahName: draft.torahName.trim(), wifePrayerName: draft.wifePrayerName.trim(), birthDate: draft.birthDate.trim(),
      yahrzeits: draft.yahrzeits.map(y => ({ ...y, name: y.name.trim(), year: y.year.trim() })),
      children: draft.children.map(child => ({
        ...child, name: child.name.trim(), birthDate: child.birthDate.trim(), torahName: child.torahName.trim(),
        barMitzvahParasha: child.barMitzvahParasha.trim(), barMitzvahDate: child.barMitzvahDate.trim(),
        spouseName: child.spouseName.trim(), spouseTorahName: child.spouseTorahName.trim(), spousePrayerName: child.spousePrayerName.trim(),
      })),
    };
    try { await saveProfile(normalized); setDraft(normalized); setSaved(JSON.stringify(normalized)); setSuccess(true); } catch (e) { setError(e instanceof Error ? e.message : 'שמירת הפרטים נכשלה.'); } finally { setBusy(false); }
  }
  return <ScrollView style={s.page} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <View style={{ gap: 5 }}><Text style={s.title}>הפרטים שלי</Text><Text style={s.muted}>כדי שהקהילה תהיה איתך ברגעים החשובים.</Text></View>
    <View style={s.card}>
      <Text style={s.heading}>נעים להכיר</Text>
      {(!draft.firstName || !draft.lastName) && draft.name && <Text style={s.muted}>השם שנשמר בעבר: {draft.name}. יש למלא שם פרטי ושם משפחה בנפרד.</Text>}
      <Field label="שם פרטי *" value={draft.firstName} onChangeText={v => change('firstName', v)} maxLength={200} editable={!busy} autoComplete="given-name" placeholder="שם פרטי" />
      <Field label="שם משפחה *" value={draft.lastName} onChangeText={v => change('lastName', v)} maxLength={200} editable={!busy} autoComplete="family-name" placeholder="שם משפחה" />
      <Choice label="כהן, לוי או ישראל *" value={draft.tribe} options={TRIBES} disabled={busy} onChange={v => change('tribe', v)} />
      <Field label="מספר הפלאפון שלי" value={draft.phone} onChangeText={v => change('phone', v)} maxLength={40} editable={!busy} keyboardType="phone-pad" autoComplete="tel" placeholder="050-1234567" style={{ writingDirection: 'ltr' }} />
      <Field label="מספר הפלאפון של אשתי" value={draft.wifePhone} onChangeText={v => change('wifePhone', v)} maxLength={40} editable={!busy} keyboardType="phone-pad" placeholder="050-1234567" style={{ writingDirection: 'ltr' }} />
      <Field label="שם לעלייה לתורה" value={draft.torahName} onChangeText={v => change('torahName', v)} maxLength={200} editable={!busy} placeholder="למשל: ישראל בן אברהם" />
      <Field label="שם האישה למי שברך" value={draft.wifePrayerName} onChangeText={v => change('wifePrayerName', v)} maxLength={200} editable={!busy} placeholder="השם ושם האב" hint="שדה רשות, בהתאם לנוסח המקובל בקהילה." />
      <Choice label="פרשת בר המצווה" value={draft.barMitzvahParasha} disabled={busy} onChange={v => change('barMitzvahParasha', v)} options={PARASHA_OPTIONS} />
      <HebrewBirthDateFields value={draft.hebrewBirthDate} onChange={value => change('hebrewBirthDate', value)} disabled={busy} />
    </View>
    <FamilyChildren value={draft.children} fatherTribe={draft.tribe} onChange={children => change('children', children)} disabled={busy} />
    <View style={s.between}><Text style={s.heading}>ימי זיכרון · יארצייט</Text><Pressable accessibilityRole="button" disabled={busy || draft.yahrzeits.length >= 30} onPress={add} hitSlop={10}><Text style={{ color: C.green, fontWeight: '700' }}>+ הוספת קרוב/ה</Text></Pressable></View>
    {!draft.yahrzeits.length && <View style={s.card}><Text style={s.text}>זוכרים יחד</Text><Text style={s.muted}>אפשר להוסיף תאריכי יארצייט לאב, אם, בן, בת, אח ואחות. התאריכים נשמרים לפי הלוח העברי.</Text><Button secondary title="הוספת יום זיכרון" onPress={add} /></View>}
    {draft.yahrzeits.map((y, i) => <View key={y.id} style={s.card}>
      <View style={s.between}><Text style={s.heading}>יום זיכרון {i + 1}</Text><Pressable accessibilityRole="button" accessibilityLabel={`הסרת יום זיכרון ${i + 1}`} disabled={busy} hitSlop={10} onPress={() => change('yahrzeits', draft.yahrzeits.filter(a => a.id !== y.id))}><Text style={{ color: C.red }}>הסרה</Text></Pressable></View>
      <Field label="שם הנפטר/ת *" value={y.name} onChangeText={name => updateYahrzeit(y.id, { name })} maxLength={200} editable={!busy} />
      <Choice label="קרבה משפחתית" value={y.relationship} options={RELATIONSHIPS} disabled={busy} onChange={relationship => updateYahrzeit(y.id, { relationship })} />
      <Choice label="חודש עברי" value={y.month} options={MONTHS} disabled={busy} onChange={month => updateYahrzeit(y.id, { month, day: y.day > birthDayOptions(month).length ? 0 : y.day })} />
      <Choice label="יום בחודש *" value={y.day ? String(y.day) : ''} options={[{ value: '', label: 'בחירת יום' }, ...birthDayOptions(y.month)]} disabled={busy} onChange={day => updateYahrzeit(y.id, { day: Number(day) })} />
    </View>)}
    <Text style={s.muted}>בחודשים חשוון וכסלו ובתאריכי אדר יש הבדלים בין שנים ומנהגים. נשמר כאן התאריך שהזנת; תזכורות שנתיות אוטומטיות אינן כלולות בגרסה זו.</Text>
    <ErrorText error={error} />
    {success && <Text accessibilityRole="alert" style={[s.text, { color: C.green }]}>{isDemo ? 'הפרטים נשמרו במכשיר ההדגמה.' : 'הפרטים נשמרו בקהילה.'}</Text>}
    {dirty && <Text style={s.muted}>יש שינויים שטרם נשמרו.</Text>}
    <Button title="שמירת הפרטים" busy={busy} onPress={() => void save()} />
    <Text style={s.muted}>{isDemo ? 'מצב הדגמה: המידע נשמר במכשיר זה בלבד.' : 'הפרטים האישיים שלך זמינים לך ולגבאי הקהילה המורשים. הם אינם מוצגים לשאר המתפללים.'}</Text>
  </ScrollView>;
}
