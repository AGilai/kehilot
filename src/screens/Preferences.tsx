import React, { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { enablePush } from '../notifications';
import { useCommunity } from '../state';
import { Preferences as PreferenceValues } from '../types';
import { Button, C, ErrorText, s } from '../ui';

const OPTIONS: { key: keyof PreferenceValues; title: string; description: string }[] = [
  { key: 'weekly', title: 'לו״ז שבועי', description: 'זמני התפילות והשיעורים שיפרסמו הגבאים' },
  { key: 'community', title: 'מזל טוב ותנחומים', description: 'להיות יחד בשמחות וברגעים הקשים' },
  { key: 'replies', title: 'תגובות להודעות', description: 'תגובות חדשות לשיחות שהשתתפת בהן' },
  { key: 'events', title: 'אירועים בבית הכנסת', description: 'מפגשים, שיעורים ופעילויות בקהילה' },
];
export function Preferences() {
  const { data, session, isDemo, savePreferences, logout } = useCommunity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!data) return null;
  async function toggle(key: keyof PreferenceValues, value: boolean) {
    if (!data) return;
    setBusy(true); setError(null); setNotice(null);
    try { await savePreferences({ ...data.preferences, [key]: value }); setNotice('ההעדפה נשמרה.'); } catch (e) { setError(e instanceof Error ? e.message : 'השמירה נכשלה.'); } finally { setBusy(false); }
  }
  async function push() {
    if (!session) return;
    setBusy(true); setError(null); setNotice(null);
    try { await enablePush(session.token); setNotice('המכשיר נרשם לקבלת התראות מהקהילה.'); } catch (e) { setError(e instanceof Error ? e.message : 'רישום ההתראות נכשל.'); } finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError(null);
    try { await logout(); } catch (e) { setError(e instanceof Error ? e.message : 'ההתנתקות נכשלה. נסו שוב.'); } finally { setBusy(false); }
  }
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <View style={{ gap: 5 }}><Text style={s.title}>בקצב שלך</Text><Text style={s.muted}>בוחרים אילו עדכונים לקבל מהקהילה.</Text></View>
    <View style={s.card}>{OPTIONS.map((item, i) => <View key={item.key} style={[s.between, { paddingVertical: 12, borderBottomWidth: i < OPTIONS.length - 1 ? 1 : 0, borderColor: C.line }]}><View style={{ flex: 1, gap: 5 }}><Text style={[s.text, { fontWeight: '700' }]}>{item.title}</Text><Text style={s.muted}>{item.description}</Text></View><Switch accessibilityLabel={item.title} value={data.preferences[item.key]} disabled={busy} onValueChange={value => void toggle(item.key, value)} trackColor={{ false: '#D9DED6', true: C.green }} thumbColor="#FFFFFF" /></View>)}</View>
    <Text style={s.muted}>ההעדפות נשמרות אוטומטית. כל ההודעות נשארות זמינות בלוח הקהילה גם כשמכבים התראות.</Text><ErrorText error={error} />
    {notice && <Text accessibilityRole="alert" style={[s.text, { color: C.green }]}>{notice}</Text>}
    <View style={s.card}><Text style={s.heading}>העדכונים מגיעים אליך</Text><Text style={s.muted}>{isDemo ? 'במצב הדגמה אפשר לשנות העדפות ולבחון את הממשק. לקבלת התראות אמיתיות נדרש חיבור לשרת וגרסה מותקנת בטלפון.' : 'הפעילו התראות במכשיר כדי לקבל הודעות גם כשהאפליקציה סגורה. נדרשת גרסה מותקנת עם הגדרת Apple ו־Firebase.'}</Text>{!isDemo && <Button title="הפעלת התראות במכשיר" onPress={() => void push()} busy={busy} />}</View>
    <View style={s.card}><Text style={s.heading}>הקהילה שלי</Text><Text style={s.muted}>גרסת מתפללים · 0.1.0 · {isDemo ? 'סביבת הדגמה מקומית' : data.verifiedPhone || session?.user.phone || session?.user.email}</Text>{!isDemo && <Button title="התנתקות" secondary onPress={() => void signOut()} busy={busy} />}</View>
  </ScrollView>;
}
