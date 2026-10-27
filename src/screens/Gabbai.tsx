import { DateField } from '../DateField';
import { GabbaiRecommendations } from './GabbaiRecommendations';
import { AssociationMembers } from './AssociationMembers';
import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { api } from '../api';
import { useCommunity } from '../state';
import { CATEGORY, Classification, MessageCategory, PersonDetails, RosterPerson, RELATIONSHIPS } from '../types';
import { Button, Choice, ErrorText, Field, s } from '../ui';
import { ProfileForm } from './Profile';
import { pickPdf } from '../pdf';
import { ClassificationFields } from './ClassificationFields';
import { Aliyot } from './GabbaiAliyot';

export function Gabbai({ onClose, onMessage }: { onClose: () => void; onMessage: (id: string) => void }) {
  const { data } = useCommunity();
  const [tool, setTool] = useState<'people' | 'publish' | 'aliyot' | 'association' | 'recommendations' | null>(null);
  if (data?.role !== 'gabbai') return null;
  if (tool === 'recommendations') return <GabbaiRecommendations onClose={() => setTool(null)} />;
  if (tool === 'association') return <AssociationMembers onClose={() => setTool(null)} />;
  if (tool === 'people') return <People onClose={() => setTool(null)} />;
  if (tool === 'publish') return <Publish onClose={() => setTool(null)} onPublished={onMessage} />;
  if (tool === 'aliyot') return <Aliyot onClose={() => setTool(null)} />;
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Button title="חזרה לבית" secondary onPress={onClose} /><Text style={s.title}>כלי הגבאי</Text>
    <Button title="רשימת המתפללים ועריכת פרטים" onPress={() => setTool('people')} />
    <Button title="פרסום הודעה או לו״ז PDF" onPress={() => setTool('publish')} />
    <Button title="מומלצים לעלייה לתורה והדפסה" onPress={() => setTool('recommendations')} />
    <Button title="רישום עליות לתורה" onPress={() => setTool('aliyot')} />
    <Button title="רשימת חברי העמותה — טעינת אקסל" secondary onPress={() => setTool('association')} />
  </ScrollView>;
}

function People({ onClose }: { onClose: () => void }) {
  const { session, refresh } = useCommunity();
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState<PersonDetails | null>(null);
  const [classification, setClassification] = useState<Classification>('קבוע');
  const [quota, setQuota] = useState('');
  const [ceremony, setCeremony] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    if (!session) return;
    setBusy(true); setError(null);
    try { setPeople(await api.roster(session.token)); } catch (e) { setError(e instanceof Error ? e.message : 'טעינת המתפללים נכשלה.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [session?.token]);
  async function edit(person: RosterPerson) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const value = await api.person(session.token, person.id);
      setClassification(value.person.classification || 'קבוע'); setQuota(value.person.allocatedSeats === null ? '' : String(value.person.allocatedSeats));
      setCeremony(value.person.barMitzvahDate); setDetails(value);
    } catch (e) { setError(e instanceof Error ? e.message : 'טעינת הפרטים נכשלה.'); }
    finally { setBusy(false); }
  }
  if (details && session) return <ProfileForm key={details.person.id} initial={details.profile} title={`עריכת ${details.person.name}`} showFamily={details.kind === 'self'} phoneLocked={!!details.verifiedPhone} onClose={() => { setDetails(null); void load(); }}
    onSave={async profile => {
      if (quota && (!/^\d+$/.test(quota) || Number(quota) > 1000)) throw new Error('יש להזין מכסת מקומות שלמה בין 0 ל־1000.');
      const saved = await api.savePerson(session.token, details.person.id, { profile, classification, allocatedSeats: classification === 'א' && quota !== '' ? Number(quota) : null, barMitzvahDate: ceremony });
      setDetails(saved); await refresh(); return saved.profile;
    }} extra={disabled => <View style={s.card}>
      <Text style={s.heading}>נתוני הגבאי</Text>{details.birthDateNote && <Text style={s.muted}>{details.birthDateNote}</Text>}{details.account && <Text style={s.muted}>{details.verifiedPhone || details.account.email} · {details.account.role === 'gabbai' ? 'גבאי' : 'מתפלל'}</Text>}
      <ClassificationFields value={classification} disabled={disabled} onChange={value => { setClassification(value); if (value !== 'א') setQuota(''); }} />
      {details.kind === 'son' && <Text style={s.muted}>בחירה בדור ב-נשוי מעדכנת גם את מצב הנישואין. מעבר לדור ב מסיר פרטי בת זוג מהפרופיל המשפחתי. מעמד הבן כהן/לוי/ישראל נקבע דרך האב.</Text>}
      {classification === 'א' && <Field label="מכסת מקומות בעזרת הגברים" keyboardType="number-pad" value={quota} onChangeText={setQuota} editable={!disabled} placeholder="טרם הוגדרה" />}
      <DateField label="תאריך שבת בר המצווה" value={ceremony} onChange={setCeremony} disabled={disabled} optional weekday={6} />
      <Text style={s.text}>עליות ב־{details.person.windowMonths ?? '—'} החודשים האחרונים: {details.person.aliyahCount ?? '—'}</Text>
      <Text style={s.text}>עלייה אחרונה: {details.person.lastAliyah}</Text>
    </View>} />;
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Button title="חזרה לכלי הגבאי" secondary onPress={onClose} /><Text style={s.title}>כל המתפללים</Text>
    <Field label="חיפוש מתפלל" value={query} onChangeText={setQuery} />
    <ErrorText error={error} /><Button title="רענון רשימה" secondary busy={busy} onPress={() => void load()} />
    {people.filter(person => `${person.name} ${person.classification} ${person.torahName} ${person.yahrzeits.map(y => `${RELATIONSHIPS.find(relation => relation.value === y.relationship)?.label || ''} ${y.name}`).join(' ')}`.includes(query.trim())).map(person => <View key={person.id} style={s.card}>
      <Text style={s.heading}>{person.name}</Text><Text style={s.muted}>{person.classification || 'טרם סווג'} · {person.tribe === 'kohen' ? 'כהן' : person.tribe === 'levi' ? 'לוי' : person.tribe === 'yisrael' ? 'ישראל' : 'מעמד לא הוגדר'}</Text>
      <Text style={s.text}>{person.lastAliyah}</Text><Button title={`פרטים ועריכה: ${person.name}`} secondary disabled={busy} onPress={() => void edit(person)} />
    </View>)}
    {!busy && !people.length && <Text style={s.muted}>אין מתפללים ברשימה.</Text>}
  </ScrollView>;
}

function Publish({ onClose, onPublished }: { onClose: () => void; onPublished: (id: string) => void }) {
  const { session, publishMessage } = useCommunity();
  const [category, setCategory] = useState<MessageCategory>('weekly');
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [pinned, setPinned] = useState(false);
  const [pdf, setPdf] = useState<Awaited<ReturnType<typeof pickPdf>>>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function pick() {
    setBusy(true); setError(null);
    try { const selected = await pickPdf(); if (selected) { setPdf(selected); setCategory('weekly'); setPinned(false); } }
    catch (e) { setError(e instanceof Error ? e.message : 'בחירת הקובץ נכשלה.'); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!session || busy) return;
    setBusy(true); setError(null);
    try {
      const added = await publishMessage({ category, title: title.trim(), body: body.trim(), pinned }, pdf || undefined);
      onPublished(added.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'הפרסום נכשל.'); }
    finally { setBusy(false); }
  }
  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Button title="חזרה לכלי הגבאי" secondary onPress={onClose} /><Text style={s.title}>פרסום לקהילה</Text>
    <View style={s.card}>
      <Choice label="סוג ההודעה" value={category} options={(Object.keys(CATEGORY) as MessageCategory[]).map(value => ({ value, label: CATEGORY[value].label }))} disabled={busy || !!pdf} onChange={setCategory} />
      <Field label="כותרת" value={title} onChangeText={setTitle} maxLength={200} editable={!busy} />
      <Field label="תוכן ההודעה" value={body} onChangeText={setBody} maxLength={10000} multiline editable={!busy} />
      <Button title="בחירת קובץ לו״ז PDF" secondary busy={busy} onPress={() => void pick()} />
      {pdf && <><Text style={s.text}>{pdf.name} · {(pdf.size / 1024 / 1024).toFixed(1)} MB</Text><Button title="הסרת הקובץ שנבחר" secondary disabled={busy} onPress={() => setPdf(null)} /></>}
      {!pdf && <View style={s.between}><Text style={s.text}>נעיצת ההודעה</Text><Switch accessibilityLabel="נעיצת ההודעה" value={pinned} onValueChange={setPinned} disabled={busy} /></View>}
      <Text style={s.muted}>ההודעה תופיע אצל כל המתפללים. התראות יישלחו בהתאם להעדפות שלהם.</Text>
      <ErrorText error={error} /><Button title={pdf ? 'פרסום ושליחת לו״ז PDF' : 'פרסום הודעה'} busy={busy} disabled={!title.trim() || (!pdf && !body.trim())} onPress={() => void publish()} />
    </View>
  </ScrollView>;
}
