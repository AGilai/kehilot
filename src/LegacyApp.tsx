import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StateProvider, useCommunity } from './state';
import { Home } from './screens/Home';
import { MessageDetail, Messages } from './screens/Messages';
import { Profile } from './screens/Profile';
import { Preferences } from './screens/Preferences';
import { HealingPrayers } from './screens/HealingPrayers';
import { Membership } from './screens/Membership';
import { Seating } from './screens/Seating';
import { Button, C, ErrorText, Field, s } from './ui';
import { listenForNotifications } from './notifications';

// The root uses direction:ltr; explicit reversed rows and RTL text are stable
// on both Hebrew-language and English-language devices, without a restart.
type Tab = 'membership' | 'home' | 'seating' | 'messages' | 'healing' | 'profile' | 'preferences';
const TABS: { id: Tab; title: string; icon: string }[] = [
  { id: 'home', title: 'הבית', icon: '⌂' }, { id: 'messages', title: 'הודעות', icon: '▤' },
  { id: 'healing', title: 'מי שברך', icon: '♡' },
  { id: 'profile', title: 'הפרטים שלי', icon: '♙' }, { id: 'preferences', title: 'העדפות', icon: '☷' },
];
function Login() {
  const { login, register, error: stateError } = useCommunity();
  const [registering, setRegistering] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { if (registering) await register(email.trim().toLowerCase(), password, firstName.trim(), lastName.trim()); else await login(email.trim().toLowerCase(), password); setPassword(''); } catch (e) { setError(e instanceof Error ? e.message : 'הכניסה נכשלה.'); } finally { setBusy(false); }
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center' }]}><Text style={{ fontSize: 52, color: C.gold, textAlign: 'right' }}>⌂</Text><Text style={s.title}>ברוכים הבאים לקהילה שלך.</Text><Text style={s.muted}>נרשמים וממלאים פרטים אישיים. הגבאי יקבע את סיווג החברות.</Text><View style={s.card}>{registering && <><Field label="שם פרטי" value={firstName} onChangeText={setFirstName} editable={!busy} /><Field label="שם משפחה" value={lastName} onChangeText={setLastName} editable={!busy} /><Text style={s.muted}>הסיסמה צריכה להכיל 12–128 תווים.</Text></>}<Field label="כתובת אימייל" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!busy} /><Field label="סיסמה" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" editable={!busy} onSubmitEditing={() => { if (email && password && !busy) void submit(); }} /><ErrorText error={error || stateError} /><Button title={registering ? "הרשמה לקהילה" : "כניסה לקהילה"} onPress={() => void submit()} busy={busy} disabled={!email.trim() || !password || (registering && (!firstName.trim() || !lastName.trim()))} /><Button title={registering ? "כבר נרשמתי — כניסה" : "משתמש חדש — הרשמה"} secondary disabled={busy} onPress={() => { setRegistering(value => !value); setError(null); }} /></View><Text style={s.muted}>אחרי ההרשמה יש להשלים ולשמור את הפרטים שלי. לשחזור סיסמה אפשר לפנות לגבאים.</Text></ScrollView>;
}
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
    if (session) void listenForNotifications(() => { void refresh().catch(() => {}); }, id => { setTab('messages'); setSelected(id); void refresh().catch(() => {}); }, () => { setTab('membership'); void refresh().catch(() => {}); }).then(fn => { if (disposed) fn(); else cleanup = fn; }).catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, [session, refresh]);
  useEffect(() => { if (selected && data?.messages.some(m => m.id === selected) && !data.readIds.includes(selected)) void markRead(selected).catch(() => setReadError('לא ניתן לסמן את ההודעה כנקראה.')); }, [selected, data?.messages]);
  useEffect(() => { if (!session && !isDemo) { setSelected(null); setTab('home'); } }, [session, isDemo]);
  useEffect(() => { if (session && data && !data.profile.tribe) setTab('profile'); }, [session?.user.id, data?.profile.tribe]);
  useEffect(() => { if (tab === 'seating' && data && !data.seating?.eligible) setTab('home'); }, [tab, data?.seating?.eligible]);
  useEffect(() => { if (tab === 'membership' && data && data.role !== 'gabbai') setTab('home'); }, [tab, data?.role]);
  function open(id: string) { setSelected(id); setReadError(null); setTab('messages'); }
  const unread = data?.messages.filter(m => !data.readIds.includes(m.id)).length || 0;
  if (loading) return <View style={[s.page, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={C.green} /><Text style={s.muted}>פותחים את הקהילה…</Text></View>;
  if (!isDemo && !session) return <Login />;
  if (!data) return <View style={[s.content, { flex: 1, justifyContent: 'center' }]}><ErrorText error={error} /><Text style={s.text}>טוענים את פרטי הקהילה…</Text><Button title="ניסיון נוסף" onPress={() => void refresh().catch(() => {})} />{session && <Button title="חזרה לכניסה" secondary onPress={() => void logout().catch(() => setReadError('לא ניתן להתנתק כעת.'))} />}<ErrorText error={readError} /></View>;
  return <View style={s.page}>
    <View style={[s.between, { paddingHorizontal: 23, paddingVertical: 15, backgroundColor: C.paper, borderBottomWidth: 1, borderColor: C.line }]}><View style={s.row}><View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 25, color: C.green }}>⌂</Text></View><Text style={[s.heading, { fontSize: 17 }]}>{process.env.EXPO_PUBLIC_COMMUNITY_NAME || 'הקהילה שלי'}</Text></View><View style={{ borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: C.bg }}><Text style={{ fontSize: 11, color: C.muted }}>{isDemo ? 'הדגמה' : 'מרחב המתפללים'}</Text></View></View>
    {error && <Text accessibilityRole="alert" style={[s.error, { padding: 10 }]}>{error}</Text>}{readError && <Text style={[s.error, { padding: 8 }]}>{readError}</Text>}
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, display: tab === 'home' ? 'flex' : 'none' }}><Home onMembership={() => setTab('membership')} onMessage={open} onMessages={() => { setSelected(null); setTab('messages'); }} onProfile={() => setTab('profile')} onSeating={() => setTab('seating')} /></View>
      <View style={{ flex: 1, display: tab === 'seating' ? 'flex' : 'none' }}>{tab === 'seating' && data?.seating?.eligible && <Seating onClose={() => setTab('home')} />}</View>
      <View style={{ flex: 1, display: tab === 'membership' ? 'flex' : 'none' }}>{tab === 'membership' && data?.role === 'gabbai' && <Membership onClose={() => setTab('home')} />}</View>
      <View style={{ flex: 1, display: tab === 'messages' ? 'flex' : 'none' }}>{selected ? <MessageDetail key={selected} id={selected} onClose={() => setSelected(null)} /> : <Messages onMessage={open} />}</View>
      <View style={{ flex: 1, display: tab === 'profile' ? 'flex' : 'none' }}><Profile /></View>
      <View style={{ flex: 1, display: tab === 'healing' ? 'flex' : 'none' }}><HealingPrayers /></View>
      <View style={{ flex: 1, display: tab === 'preferences' ? 'flex' : 'none' }}><Preferences /></View>
    </View>
    <View style={{ flexDirection: 'row-reverse', backgroundColor: C.paper, borderTopWidth: 1, borderColor: C.line, paddingTop: 10, paddingBottom: 8 }}>{TABS.map(t => <Pressable accessibilityRole="tab" accessibilityState={{ selected: (tab === t.id || (tab === 'seating' && t.id === 'home')) }} accessibilityLabel={t.title} key={t.id} onPress={() => { setTab(t.id); if (t.id === 'messages') setSelected(null); }} style={{ flex: 1, alignItems: 'center', gap: 4, minHeight: 52 }}><View><Text style={{ fontSize: 25, color: (tab === t.id || (tab === 'seating' && t.id === 'home')) ? C.green : '#99A39B' }}>{t.icon}</Text>{t.id === 'messages' && unread > 0 && <View style={{ position: 'absolute', right: -11, top: -3, backgroundColor: C.green, borderRadius: 10, minWidth: 17, paddingHorizontal: 4, alignItems: 'center' }}><Text style={{ fontSize: 10, color: '#FFFFFF' }}>{unread > 99 ? '99+' : unread}</Text></View>}</View><Text style={{ fontSize: 11, color: (tab === t.id || (tab === 'seating' && t.id === 'home')) ? C.green : C.muted, fontWeight: (tab === t.id || (tab === 'seating' && t.id === 'home')) ? '700' : '400' }}>{t.title}</Text></Pressable>)}</View>
  </View>;
}
export default function App() {
  return <SafeAreaProvider><SafeAreaView style={s.page}><StatusBar style="dark" /><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><StateProvider><Shell /></StateProvider></KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>;
}
