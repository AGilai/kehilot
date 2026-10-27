import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useCommunity } from '../state';
import { prayerAddedDate } from '../healingPrayers';
import { Button, C, ErrorText, Field, s } from '../ui';

export function HealingPrayers() {
  const { data, isDemo, refresh, addHealingPrayer, deleteHealingPrayer, keepHealingPrayer } = useCommunity();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'add' | 'delete' | 'keep' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!data) return null;
  async function add() {
    if (busy) return;
    setBusy('add'); setError(null); setNotice(null);
    try { await addHealingPrayer(name); setName(''); setNotice('השם נוסף לרשימת מי שברך לחולים.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'לא ניתן להוסיף את השם.'); }
    finally { setBusy(null); }
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy('delete'); setError(null); setNotice(null);
    try { await deleteHealingPrayer(id); setRemoving(null); setNotice('השם נמחק מהרשימה.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'לא ניתן למחוק את השם.'); }
    finally { setBusy(null); }
  }
  async function reload() {
    setRefreshing(true); setError(null);
    try { await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'לא ניתן לטעון את הרשימה.'); }
    finally { setRefreshing(false); }
  }
  async function keep(id: string, cycleId: string) {
    if (busy) return;
    setBusy('keep'); setError(null); setNotice(null);
    try { await keepHealingPrayer(id, cycleId); setNotice('השם נשאר ברשימה. נזכיר לך לבדוק שוב בעוד שבועיים.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'לא ניתן לעדכן את השם.'); }
    finally { setBusy(null); }
  }
  return <ScrollView style={s.page} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={C.green} />}>
    <View style={{ gap: 5 }}><Text style={s.title}>מי שברך לחולים</Text><Text style={s.muted}>מוסיפים שם לתפילה לרפואה שלמה ומנהלים את השמות שהוספת.</Text></View>
    <View style={s.card}>
      <Text style={s.heading}>הוספת שם לתפילה</Text>
      <Field label="שם למי שברך לחולים *" value={name} onChangeText={setName} editable={!busy} maxLength={200} placeholder="השם ושם האם" hint="יש לכתוב את שם החולה ושם אמו." />
      <Button title="הוספת שם" onPress={() => void add()} disabled={!!busy || !name.trim()} busy={busy === 'add'} />
      <Text style={s.muted}>בעוד שבועיים נזכיר לך לבדוק אם להשאיר את השם. אם לא תתקבל תשובה עד חודש מההוספה או מהאישור האחרון, השם יוסר אוטומטית.</Text>
    </View>
    <ErrorText error={error} />
    {notice && <Text accessibilityRole="alert" style={[s.text, { color: C.green }]}>{notice}</Text>}
    <View style={s.between}><Text style={s.heading}>השמות שהוספתי</Text><Text style={s.muted}>{data.healingPrayers.length === 1 ? 'שם אחד' : `${data.healingPrayers.length} שמות`}</Text></View>
    {!data.healingPrayers.length && <View style={s.card}><Text style={s.text}>עדיין לא הוספת שמות.</Text><Text style={s.muted}>השמות שתוסיף יופיעו כאן עם תאריך ההוספה.</Text></View>}
    {[...data.healingPrayers].sort((a, b) => Number(!!b.reminder?.pending) - Number(!!a.reminder?.pending)).map(entry => <View key={entry.id} style={s.card}>
      <View style={s.between}><Text style={[s.heading, { flex: 1 }]}>{entry.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`מחיקת ${entry.name}`} disabled={!!busy} hitSlop={10} onPress={() => { setRemoving(entry.id); setError(null); setNotice(null); }}><Text style={{ color: C.red }}>מחיקה</Text></Pressable></View>
      <Text style={s.muted}>{entry.reminder?.confirmedOn ? 'אישור אחרון' : 'תאריך הוספה'}: {prayerAddedDate(entry.addedOn)}</Text>
      {entry.reminder?.pending && <View style={{ gap: 12, padding: 14, backgroundColor: C.pale, borderRadius: 12 }}>
        <Text accessibilityRole="alert" style={s.text}>{entry.reminder.confirmedOn ? 'חלפו שבועיים מאז שאישרת להשאיר את השם ברשימה.' : 'חלפו שבועיים מאז שהוספת את השם למי שברך לחולים.'} האם להשאיר את השם ברשימה או להסירו?</Text>
        <Text style={s.muted}>ללא תשובה, השם יוסר אוטומטית בתאריך {prayerAddedDate(entry.reminder.expiresOn)}.</Text>
        <Button title="להשאיר ברשימה" disabled={!!busy} busy={busy === 'keep'} onPress={() => void keep(entry.id, entry.reminder!.cycleId)} />
        <Button title="להסיר מהרשימה" secondary disabled={!!busy} onPress={() => { setRemoving(entry.id); setError(null); setNotice(null); }} />
      </View>}
      {removing === entry.id && <View style={{ gap: 10 }}>
        <Text style={s.text}>למחוק את השם מהרשימה?</Text>
        <Button title="מחיקת השם" secondary disabled={!!busy} busy={busy === 'delete'} onPress={() => void remove(entry.id)} />
        <Button title="ביטול" secondary disabled={!!busy} onPress={() => setRemoving(null)} />
      </View>}
    </View>)}
    <Text style={s.muted}>{isDemo ? 'מצב הדגמה: השמות נשמרים במכשיר זה בלבד.' : 'מוצגים השמות שהוספת. השמות זמינים גם לגבאים לצורך מי שברך לחולים.'}</Text>
  </ScrollView>;
}
