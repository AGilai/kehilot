import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadShabbat, loadZmanim } from '../api';
import { clockTime, dayOfWeek, displayDate, dualDate, israelDate } from '../dates';
import { useCommunity } from '../state';
import { Shabbat, Zmanim } from '../types';
import { Button, C, ErrorText, s } from '../ui';
import { MessageCard } from './Messages';
import { isCurrentZmanim, YESHIVA_REFERENCE_SOURCE, ZMANIM_CACHE_PREFIX } from '../zmanim';
import { isManagement } from '../client/roles.ts';

const TIMES = [
  ['sunrise', 'הנץ החמה', '☀'], ['sofZmanShma', 'סוף זמן קריאת שמע', '◷'],
  ['sofZmanTfilla', 'סוף זמן תפילה', '◷'], ['minchaGedola', 'מנחה גדולה', '☀'],
  ['plagHaMincha', 'פלג המנחה', '◴'], ['sunset', 'שקיעה', '◒'], ['nightfall', 'צאת הכוכבים', '✧'],
] as const;

export function Home({ onMessage, onMessages, onProfile, onSeating, onMembership }: { onMessage: (id: string) => void; onMessages: () => void; onProfile: () => void; onSeating: () => void; onMembership: () => void }) {
  const { data, isDemo, refresh } = useCommunity();
  const [now, setNow] = useState(new Date());
  const date = israelDate(now);
  const [zmanim, setZmanim] = useState<Zmanim | null>(null);
  const [shabbat, setShabbat] = useState<Shabbat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shabbatError, setShabbatError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [cached, setCached] = useState(false);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 30000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true); setError(null); setShabbatError(null); setZmanim(null); setShabbat(null); setCached(false);
    (async () => {
      try {
        const fresh = await loadZmanim(date);
        if (active) { setZmanim(fresh); setCached(false); }
        await AsyncStorage.setItem(`${ZMANIM_CACHE_PREFIX}.${date}`, JSON.stringify(fresh)).catch(() => {});
      } catch {
        const raw = await AsyncStorage.getItem(`${ZMANIM_CACHE_PREFIX}.${date}`).catch(() => null);
        if (!active) return;
        let valid = false;
        try {
          const saved = raw ? JSON.parse(raw) : null;
          if (isCurrentZmanim(saved, date)) { setZmanim(saved); setCached(true); valid = true; }
        } catch { /* Never display another day's times or a corrupt cache. */ }
        setError(valid ? 'אין חיבור למקור הזמנים. מוצגים זמנים שנשמרו להיום.' : 'לא ניתן לטעון את זמני היום. בדקו את החיבור ונסו שוב.');
      } finally { if (active) setBusy(false); }
    })();
    loadShabbat(date).then(value => { if (active) setShabbat(value); }).catch(() => { if (active) setShabbatError('לא ניתן לטעון את זמני כניסת השבת כרגע.'); });
    return () => { active = false; };
  }, [date, revision]);
  if (!data) return null;
  const todayTimes = zmanim?.date === date ? zmanim : null;
  const next = todayTimes ? TIMES.find(([key]) => new Date(todayTimes.times[key] || '').getTime() > now.getTime()) : null;
  const messages = [...data.messages].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
  const firstName = data.profile.firstName?.trim() || data.profile.name.trim();
  const seatingNeedsReport = data.seating?.eligible && data.seating.event.mode === 'needed' && !data.seating.reported;
  function reload() { setRevision(n => n + 1); void refresh().catch(() => {}); }
  return <ScrollView style={s.page} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} tintColor={C.green} />}>
    <View style={{ gap: 6 }}><Text style={s.muted}>{dualDate(date, 'he', { weekday: true, year: true })}</Text><Text style={s.title}>{firstName ? `שלום, ${firstName}` : 'טוב להיות בקהילה'}</Text><Text style={s.muted}>התפילות, הרגעים והאנשים שמחברים בינינו.</Text></View>
    {isManagement(data.role) && <Pressable accessibilityRole="button" accessibilityLabel="מתפללים חדשים לסיווג" onPress={onMembership} style={[s.card, { backgroundColor: C.pale }]}><Text style={s.heading}>מתפללים חדשים לסיווג</Text><Text style={s.muted}>ממתינים לסיווג: {data.membershipRequests?.length || 0}</Text></Pressable>}
    {!isDemo && !data.seating?.eligible && !data.profile.tribe && <Text style={s.muted}>יש להשלים ולשמור את הפרטים שלי כדי להעבירם לגבאי לסיווג.</Text>}
    {!isDemo && data.classification === '' && !!data.profile.tribe && <Text style={s.muted}>הפרטים נשלחו לגבאי. ממתינים לסיווג החברות.</Text>}
    {data.seating?.eligible && <Pressable accessibilityRole="button" accessibilityLabel="עדכון מקומות לשבת" onPress={onSeating} style={[s.card, s.between, { backgroundColor: C.pale }]}><View style={{ flex: 1, gap: 5 }}><Text style={s.heading}>עדכון מקומות לשבת ולחג</Text><Text style={[s.muted, seatingNeedsReport && { color: C.red }]}>{seatingNeedsReport ? 'נדרש דיווח פעיל כדי לשמור מקומות למשפחה' : 'מקומות המשפחה בעזרת הגברים'}</Text></View><Text style={{ color: C.green, fontSize: 23 }}>←</Text></Pressable>}
    <View style={{ backgroundColor: C.green, borderRadius: 24, padding: 23, gap: 16 }}>
      <View style={s.between}><Text style={{ color: '#D8E8DC', fontSize: 14 }}>זמני היום · פתח תקווה</Text><Text style={{ color: '#D9C28B', fontSize: 24 }}>☀</Text></View>
      {busy && !todayTimes ? <ActivityIndicator color="#FFFFFF" /> : next ? <View style={s.between}><View style={{ gap: 5 }}><Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 20, textAlign: 'right' }}>{next[1]}</Text><Text style={{ color: '#C1D8CC', fontSize: 13, textAlign: 'right' }}>הזמן הבא היום{cached ? ' · נשמר במכשיר' : ''}</Text></View><Text style={{ color: '#FFFFFF', fontSize: 42, fontWeight: '300', fontVariant: ['tabular-nums'] }}>{clockTime(todayTimes?.times[next[0]])}</Text></View> : <Text style={{ color: '#FFFFFF', fontSize: 19, textAlign: 'right' }}>{todayTimes ? 'ערב טוב לקהילה' : 'זמני היום יופיעו כאן עם החיבור למקור'}</Text>}
      <Text style={{ color: '#C1D8CC', fontSize: 12, textAlign: 'right' }}>{shabbat?.parasha || 'הקהילה שלי'} · לפי שעון ישראל</Text>
    </View>
    <View style={{ gap: 12 }}><View style={s.between}><Text style={s.heading}>סדר היום, במבט אחד</Text><Text style={s.muted}>פתח תקווה</Text></View><View style={[s.card, { paddingVertical: 5 }]}>{TIMES.map(([key, label, symbol], i) => <View key={key} style={[s.between, { paddingVertical: 12, borderBottomColor: C.line, borderBottomWidth: i === TIMES.length - 1 ? 0 : 1 }]}><View style={s.row}><Text style={{ color: C.gold, width: 22, textAlign: 'center', fontSize: 20 }}>{symbol}</Text><Text style={[s.text, next?.[0] === key && { color: C.green, fontWeight: '700' }]}>{label}</Text></View><Text accessibilityLabel={`${label}: ${clockTime(todayTimes?.times[key])}`} style={{ color: C.ink, fontSize: 18, fontVariant: ['tabular-nums'] }}>{clockTime(todayTimes?.times[key])}</Text></View>)}</View><ErrorText error={error} />{error && <Button title="טעינה מחדש" secondary onPress={reload} busy={busy} />}<Text style={s.muted}>{todayTimes?.source === YESHIVA_REFERENCE_SOURCE ? 'לוח אתר ישיבה · זמנים שהועתקו מהלוח לתאריך המוצג. קריאת שמע ותפילה: הגר״א.' : 'לפי כללי לוח אתר ישיבה · קריאת שמע ותפילה: הגר״א · בסיס אסטרונומי: Hebcal. ייתכנו הבדלים של דקות מלוח האתר.'} התאריך העברי מתייחס ליום האזרחי.</Text><Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://www.yeshiva.org.il/calendar/timeprinciples')}><Text style={[s.muted, { color: C.green, textDecorationLine: 'underline' }]}>על מקור הזמנים ושיטת החישוב ↗</Text></Pressable></View>
    <View style={[s.card, { backgroundColor: '#F5F0E3', borderColor: '#EBE2CD' }]}><View style={s.between}><Text style={s.heading}>{dayOfWeek(date) === 5 ? 'היום מקבלים את השבת' : 'לקראת שבת'}</Text><Text style={{ color: C.gold, fontSize: 24 }}>✧</Text></View><Text style={s.muted}>{shabbat ? `${shabbat.parasha} · ${displayDate(shabbat.friday)}` : 'כניסת שבת ביום שישי הקרוב'}</Text><View style={s.between}><Text style={s.text}>פתח תקווה</Text><Text style={[s.heading, { fontVariant: ['tabular-nums'] }]}>{clockTime(shabbat?.petahTikva)}</Text></View><View style={s.between}><Text style={s.text}>תל אביב</Text><Text style={[s.heading, { fontVariant: ['tabular-nums'] }]}>{clockTime(shabbat?.telAviv)}</Text></View><Text style={s.muted}>לפי כללי אתר ישיבה: פתח תקווה 40 דקות לפני השקיעה; תל אביב 21 דקות. חישוב אסטרונומי: Hebcal.</Text><ErrorText error={shabbatError} />{shabbatError && <Button title="ניסיון נוסף" secondary onPress={reload} />}</View>
    <View style={{ gap: 12 }}><View style={s.between}><Text style={s.heading}>מה חדש בקהילה</Text><Pressable accessibilityRole="button" onPress={onMessages} hitSlop={10}><Text style={{ color: C.green, fontWeight: '600' }}>לכל ההודעות ←</Text></Pressable></View>{messages.length ? messages.map(m => <MessageCard key={m.id} message={m} unread={!data.readIds.includes(m.id)} onPress={() => onMessage(m.id)} />) : <View style={s.card}><Text style={s.text}>כאן יופיעו ההודעות מהגבאים.</Text></View>}</View>
    <Pressable accessibilityRole="button" onPress={onProfile} style={[s.card, s.between]}><View style={{ flex: 1, gap: 5 }}><Text style={s.heading}>הפרטים שלך, לקהילה שלך</Text><Text style={s.muted}>שם לעלייה לתורה, פרשת בר המצווה וימי זיכרון</Text></View><Text style={{ color: C.green, fontSize: 23 }}>←</Text></Pressable>
    {isDemo && <Text style={s.muted}>מצב הדגמה · השמות וההודעות בדויים. הפרטים והתגובות נשמרים במכשיר זה בלבד. מקור זמני היום מצוין ליד הטבלה.</Text>}
  </ScrollView>;
}
