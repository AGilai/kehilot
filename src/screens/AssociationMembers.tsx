import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { pickSpreadsheet } from '../pdf';
import { useCommunity } from '../state';
import type { AssociationMember } from '../types';
import { Button, ErrorText, Field, s } from '../ui';

export function AssociationMembers({ onClose }: { onClose: () => void }) {
  const { session, refresh } = useCommunity();
  const [members, setMembers] = useState<AssociationMember[]>([]);
  const [file, setFile] = useState<Awaited<ReturnType<typeof pickSpreadsheet>>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!session) return;
    let active = true;
    setBusy(true);
    void api.associationMembers(session.token).then(result => { if (active) setMembers(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'טעינת הרשימה נכשלה.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [session?.token]);
  async function choose() {
    setBusy(true); setError(null); setNotice(null);
    try { setFile(await pickSpreadsheet()); }
    catch (e) { setError(e instanceof Error ? e.message : 'בחירת הקובץ נכשלה.'); }
    finally { setBusy(false); }
  }
  async function upload() {
    if (!session || !file) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api.importMembers(session.token, file);
      setFile(null); setNotice(`הרשימה נשמרה בשרת: ${result.added} חברים חדשים, ${result.updated} רשומות עודכנו.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'הטעינה לשרת נכשלה.'); return; }
    finally { setBusy(false); }
    // A refresh failure must not describe the committed import as a failure.
    try { setMembers(await api.associationMembers(session.token)); await refresh(); }
    catch { setError('הרשימה נשמרה, אך הרענון נכשל. אפשר לפתוח את המסך מחדש.'); }
  }
  const filtered = members.filter(member => `${member.name} ${member.phone}`.includes(query.trim()));
  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Button title="חזרה לכלי הגבאי" secondary onPress={onClose} disabled={busy} />
    <Text style={s.title}>רשימת חברי העמותה</Text>
    <View style={s.card}>
      <Text style={s.text}>בחרו קובץ אקסל ‎.xlsx עם כותרות העמודות: שם פרטי, שם משפחה, פלאפון. אפשר גם שם מלא ופלאפון.</Text>
      <Text style={s.muted}>מספרים ברשימה יקבלו גישת חבר עמותה לאחר אימות ב־SMS. טעינת קובץ מוסיפה או מעדכנת מספרים; היא אינה מוחקת חברים או משנה סיווג שקבע הגבאי.</Text>
      <Button title="בחירת קובץ אקסל" secondary busy={busy} onPress={() => void choose()} />
      {file && <><Text style={s.text}>{file.name}</Text><Button title="טעינת חברי העמותה לשרת" disabled={busy} onPress={() => void upload()} /></>}
      <ErrorText error={error} />
      {notice && <Text accessibilityRole="alert" style={s.text}>{notice}</Text>}
    </View>
    <Text style={s.heading}>ברשימה: {members.length}</Text>
    <Field label="חיפוש לפי שם או מספר" value={query} onChangeText={setQuery} />
    {filtered.slice(0, 50).map(member => <View key={member.phone} style={s.card}>
      <Text style={s.heading}>{member.name}</Text><Text style={s.text}>{member.phone}</Text>
      <Text style={s.muted}>{member.registered ? 'קיים חשבון עם מספר מאומת' : 'טרם נרשם עם מספר זה'}</Text>
    </View>)}
    {filtered.length > 50 && <Text style={s.muted}>מוצגים 50 שמות ראשונים. אפשר לצמצם באמצעות החיפוש.</Text>}
  </ScrollView>;
}
