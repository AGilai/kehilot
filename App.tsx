import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StateProvider, useCommunity } from './src/state';
import { Home } from './src/screens/Home';
import { MessageDetail, Messages } from './src/screens/Messages';
import { Profile } from './src/screens/Profile';
import { Preferences } from './src/screens/Preferences';
import { HealingPrayers } from './src/screens/HealingPrayers';
import { Gabbai } from './src/screens/Gabbai';
import { PhoneLogin } from './src/screens/PhoneLogin';
import { Seating } from './src/screens/Seating';
import { Button, C, ErrorText, s } from './src/ui';
import { listenForNotifications } from './src/notifications';
import { unreadMessageCount } from './src/inbox';

// The root uses direction:ltr; explicit reversed rows and RTL text are stable
// on both Hebrew-language and English-language devices, without a restart.
type Tab = 'gabbai' | 'home' | 'seating' | 'messages' | 'healing' | 'profile' | 'preferences';
const TABS: { id: Tab; title: string; icon: string }[] = [
  { id: 'home', title: 'הבית', icon: '⌂' }, { id: 'messages', title: 'הודעות', icon: '▤' },
  { id: 'healing', title: 'מי שברך', icon: '♡' },
  { id: 'profile', title: 'הפרטים שלי', icon: '♙' }, { id: 'preferences', title: 'העדפות', icon: '☷' },
];
function Shell() {
  const { data, loading, session, isDemo, error, refresh, markRead, logout } = useCommunity();
  const [tab, setTab] = useState<Tab>('home');
  const [selected, setSelected] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selected) { setSelected(null); return true; }
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [selected, tab]);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    if (session) void listenForNotifications(() => { void refresh().catch(() => {}); }, () => { setTab('messages'); setSelected(null); setReadError(null); }, session.token).then(fn => { if (disposed) fn(); else cleanup = fn; }).catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, [session, refresh]);
  useEffect(() => { if (tab === 'messages' && selected && data?.messages.some(m => m.id === selected) && !data.readIds.includes(selected)) void markRead(selected).catch(() => setReadError('לא ניתן לסמן את ההודעה כנקראה.')); }, [tab, selected, data?.messages, data?.readIds]);
  useEffect(() => { if (!session && !isDemo) { setSelected(null); setTab('home'); } }, [session, isDemo]);
  useEffect(() => { if (session && data && !data.profile.tribe) setTab('profile'); }, [session?.user.id, data?.profile.tribe]);
  useEffect(() => { if (tab === 'seating' && data && !data.seating?.eligible) setTab('home'); }, [tab, data?.seating?.eligible]);
  useEffect(() => { if (tab === 'gabbai' && data && data.role !== 'gabbai') setTab('home'); }, [tab, data?.role]);
  function open(id: string) { setSelected(id); setReadError(null); setTab('messages'); }
  const unread = data ? unreadMessageCount(data) : 0;
  const healingDue = data?.healingPrayers.filter(entry => entry.reminder?.pending).length || 0;
  if (loading) return <View style={[s.page, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={C.green} /><Text style={s.muted}>פותחים את הקהילה…</Text></View>;
  if (!isDemo && !session) return <PhoneLogin />;
  if (!data) return <View style={[s.content, { flex: 1, justifyContent: 'center' }]}><ErrorText error={error} /><Text style={s.text}>טוענים את פרטי הקהילה…</Text><Button title="ניסיון נוסף" onPress={() => void refresh().catch(() => {})} />{session && <Button title="חזרה לכניסה" secondary onPress={() => void logout().catch(() => setReadError('לא ניתן להתנתק כעת.'))} />}<ErrorText error={readError} /></View>;
  return <View style={s.page}>
    <View style={[s.between, { paddingHorizontal: 23, paddingVertical: 15, backgroundColor: C.paper, borderBottomWidth: 1, borderColor: C.line }]}><View style={s.row}><View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 25, color: C.green }}>⌂</Text></View><Text style={[s.heading, { fontSize: 17 }]}>{process.env.EXPO_PUBLIC_COMMUNITY_NAME || 'הקהילה שלי'}</Text></View><View style={{ borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: C.bg }}><Text style={{ fontSize: 11, color: C.muted }}>{isDemo ? 'הדגמה' : data.role === 'gabbai' ? 'מרחב הגבאי' : 'מרחב המתפללים'}</Text></View></View>
    {error && <Text accessibilityRole="alert" style={[s.error, { padding: 10 }]}>{error}</Text>}{readError && <Text style={[s.error, { padding: 8 }]}>{readError}</Text>}
    {healingDue > 0 && !['healing', 'messages'].includes(tab) && <Pressable accessibilityRole="button" accessibilityLabel="תזכורת לעדכון מי שברך לחולים" onPress={() => { setSelected(null); setTab('messages'); }} style={{ paddingHorizontal: 23, paddingVertical: 12, backgroundColor: C.pale }}><Text style={[s.text, { color: C.green }]}>תזכורת למי שברך לחולים: {healingDue === 1 ? 'שם אחד ממתין לתשובתך' : `${healingDue} שמות ממתינים לתשובתך`} — לפתיחת ההודעות</Text></Pressable>}
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, display: tab === 'home' ? 'flex' : 'none' }}><Home onGabbai={() => setTab('gabbai')} onMessage={open} onMessages={() => { setSelected(null); setTab('messages'); }} onProfile={() => setTab('profile')} onSeating={() => setTab('seating')} /></View>
      <View style={{ flex: 1, display: tab === 'seating' ? 'flex' : 'none' }}>{tab === 'seating' && data?.seating?.eligible && <Seating onClose={() => setTab('home')} />}</View>
      <View style={{ flex: 1, display: tab === 'gabbai' ? 'flex' : 'none' }}>{tab === 'gabbai' && data.role === 'gabbai' && <Gabbai onClose={() => setTab('home')} onMessage={open} />}</View>
      <View style={{ flex: 1, display: tab === 'messages' ? 'flex' : 'none' }}>{selected ? <MessageDetail key={selected} id={selected} onClose={() => setSelected(null)} /> : <Messages onMessage={open} />}</View>
      <View style={{ flex: 1, display: tab === 'profile' ? 'flex' : 'none' }}><Profile /></View>
      <View style={{ flex: 1, display: tab === 'healing' ? 'flex' : 'none' }}><HealingPrayers /></View>
      <View style={{ flex: 1, display: tab === 'preferences' ? 'flex' : 'none' }}><Preferences /></View>
    </View>
    <View style={{ flexDirection: 'row-reverse', backgroundColor: C.paper, borderTopWidth: 1, borderColor: C.line, paddingTop: 10, paddingBottom: 8 }}>{TABS.map(t => <Pressable accessibilityRole="tab" accessibilityState={{ selected: (tab === t.id || (tab === 'seating' && t.id === 'home')) }} accessibilityLabel={t.title} accessibilityValue={t.id === 'messages' ? { text: unread ? `${unread} הודעות שלא נקראו` : 'כל ההודעות נקראו' } : undefined} key={t.id} onPress={() => { setTab(t.id); if (t.id === 'messages') setSelected(null); }} style={{ flex: 1, alignItems: 'center', gap: 4, minHeight: 52 }}><View><Text style={{ fontSize: 25, color: (tab === t.id || (tab === 'seating' && t.id === 'home')) ? C.green : '#99A39B' }}>{t.icon}</Text>{t.id === 'messages' && unread > 0 && <View accessible accessibilityLabel={`${unread} הודעות שלא נקראו`} style={{ position: 'absolute', right: -6, top: 0, backgroundColor: C.red, borderRadius: 5, width: 10, height: 10 }} />}</View><Text style={{ fontSize: 11, color: (tab === t.id || (tab === 'seating' && t.id === 'home')) ? C.green : C.muted, fontWeight: (tab === t.id || (tab === 'seating' && t.id === 'home')) ? '700' : '400' }}>{t.title}</Text></Pressable>)}</View>
  </View>;
}
export default function App() {
  return <SafeAreaProvider><SafeAreaView style={s.page}><StatusBar style="dark" /><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><StateProvider><Shell /></StateProvider></KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>;
}
