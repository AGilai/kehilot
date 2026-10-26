import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { normalizeMobile } from '../phone';
import { useCommunity } from '../state';
import type { PhoneChallenge } from '../types';
import { Button, C, ErrorText, Field, s } from '../ui';

export function PhoneLogin() {
  const { verifyPhone, error: stateError } = useCommunity();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<PhoneChallenge | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const expired = !!challenge && now >= expiresAt;
  async function request() {
    const normalized = normalizeMobile(phone);
    if (!normalized || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await api.requestPhoneCode(normalized);
      const timestamp = Date.now();
      setChallenge(result); setCode(''); setRetryAt(timestamp + result.retryAfter * 1000);
      setExpiresAt(timestamp + result.expiresIn * 1000); setNow(timestamp);
    } catch (e) { setError(e instanceof Error ? e.message : 'שליחת הקוד נכשלה.'); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (!challenge || busy || expired) return;
    setBusy(true); setError(null);
    try { await verifyPhone(challenge.challengeId, code); }
    catch (e) { setError(e instanceof Error ? e.message : 'אימות הקוד נכשל.'); }
    finally { setBusy(false); }
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center' }]}>
    <Text style={{ fontSize: 52, color: C.gold, textAlign: 'right' }}>⌂</Text>
    <Text style={s.title}>ברוכים הבאים לקהילה שלך.</Text>
    <Text style={s.muted}>נכנסים עם מספר הפלאפון וקוד חד־פעמי ב־SMS.</Text>
    <View style={s.card}>
      {!challenge ? <>
        <Field label="מספר הפלאפון שלי" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" autoCorrect={false} maxLength={40} editable={!busy} placeholder="050-1234567" style={{ writingDirection: 'ltr' }} />
        <Button title="שליחת קוד אימות" onPress={() => void request()} busy={busy} disabled={!normalizeMobile(phone)} />
      </> : <>
        <Text style={s.text}>שלחנו קוד למספר {phone}. הקוד תקף לחמש דקות.</Text>
        <Field label="קוד אימות בן שש ספרות" value={code} onChangeText={value => setCode(value.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" autoCorrect={false} maxLength={6} editable={!busy && !expired} style={{ writingDirection: 'ltr' }} onSubmitEditing={() => { if (code.length === 6) void verify(); }} />
        {expired && <Text style={s.muted}>תוקף הקוד פג. יש לבקש קוד חדש.</Text>}
        <Button title="אימות וכניסה לקהילה" onPress={() => void verify()} busy={busy} disabled={code.length !== 6 || expired} />
        <Button title={wait ? `שליחת קוד נוסף בעוד ${wait} שניות` : 'שליחת קוד חדש'} secondary disabled={busy || wait > 0} onPress={() => void request()} />
        <Button title="שינוי מספר הפלאפון" secondary disabled={busy} onPress={() => { setChallenge(null); setCode(''); setError(null); }} />
      </>}
      <ErrorText error={error || stateError} />
    </View>
    <Text style={s.muted}>מספר שמופיע ברשימת חברי העמותה יקבל גישת חבר עמותה. אם המספר אינו ברשימה, ניתן להירשם כמתפלל קבוע. שינוי הסיווג בהמשך נעשה בידי הגבאי.</Text>
  </ScrollView>;
}
