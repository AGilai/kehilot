import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { aliyahCalls, aliyahChoices, aliyahLabel, aliyahSlots, FESTIVAL_READINGS } from '../aliyot';
import { civilDate, israelDate } from '../dates';
import { useCommunity } from '../state';
import { AliyahRecord, AliyahService, AliyahTemplate, PARASHA_OPTIONS, RosterPerson } from '../types';
import { Button, Choice, ErrorText, Field, s } from '../ui';

function recentSaturday() {
  const day = civilDate(israelDate(new Date()));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 1) % 7);
  return day.toISOString().slice(0, 10);
}

export function Aliyot({ onClose }: { onClose: () => void }) {
  const { session } = useCommunity();
  const scroll = useRef<ScrollView>(null);
  const [day, setDay] = useState(recentSaturday);
  const [service, setService] = useState<AliyahService>('shacharit');
  const [minyan, setMinyan] = useState(1);
  const [template, setTemplate] = useState<AliyahTemplate | null>(null);
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [records, setRecords] = useState<AliyahRecord[]>([]);
  const [editing, setEditing] = useState<AliyahRecord | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(''); const [extras, setExtras] = useState(0);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!session) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setTemplate(null); setLoading(false); setError(null); return; }
    let active = true;
    setLoading(true); setError(null); setTemplate(null); setSelected({}); setExtras(0);
    void Promise.all([api.aliyahTemplate(session.token, day, service), api.roster(session.token), api.aliyahRecords(session.token)]).then(([next, roster, history]) => {
      if (!active) return;
      setTemplate(next); setPeople(roster); setRecords(history);
      setReading(editing?.reading || next.reading);
      if (editing) {
        setExtras(Math.max(0, editing.calls.length - next.slots.length));
        setSelected(Object.fromEntries(editing.calls.map(call => [call.position, call.guest ? 'guest' : call.personId ? `person:${call.personId}` : ''])));
      }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'טעינת נתוני העליות נכשלה.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.token, day, service, editing?.id, revision]);
  let slots = template?.slots || [];
  try { if (template) slots = aliyahSlots(template, extras); } catch { /* A legacy incomplete record is completed through the current template. */ }
  async function save() {
    if (!session || !template || busy || loading) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const saved = await api.saveAliyot(session.token, { date: day, service, minyan, reading, calls: aliyahCalls(slots, selected), cancelled: false }, editing?.id);
      setEditing(saved); setRecords(await api.aliyahRecords(session.token)); setNotice('רישום העליות נשמר.');
    } catch (e) { setError(e instanceof Error ? e.message : 'שמירת העליות נכשלה.'); }
    finally { setBusy(false); }
  }
  const readings = [...new Set([reading, template?.reading || '', ...PARASHA_OPTIONS.map(option => option.value), ...FESTIVAL_READINGS])].filter(Boolean).map(value => ({ value, label: value }));
  return <ScrollView ref={scroll} style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Button title="חזרה לכלי הגבאי" secondary onPress={onClose} /><Text style={s.title}>רישום עליות לתורה</Text>
    <View style={s.card}>
      <Field label="תאריך השבת או החג (YYYY-MM-DD)" value={day} onChangeText={value => { setDay(value); setEditing(null); setNotice(null); }} editable={!busy} autoCapitalize="none" />
      <Choice label="תפילה" value={service} options={[{ value: 'shacharit', label: 'שחרית' }, { value: 'mincha', label: 'מנחה של יום כיפור' }]} disabled={busy} onChange={value => { setService(value); setEditing(null); }} />
      <Choice label="מספר המניין" value={String(minyan)} options={Array.from({ length: Math.max(10, minyan) }, (_, index) => ({ value: String(index + 1), label: `מניין ${index + 1}` }))} disabled={busy} onChange={value => setMinyan(Number(value))} />
      <Button title="טעינת העליות לתאריך" secondary busy={loading} disabled={busy} onPress={() => setRevision(value => value + 1)} />
      {template && <>
        <Choice label="פרשת השבוע או החג" value={reading} options={readings} disabled={busy || loading} onChange={value => { setReading(value); if (value === 'יום כיפור - מנחה' && service !== 'mincha') { setService('mincha'); setEditing(null); } else if (value === 'יום כיפור - שחרית' && service !== 'shacharit') { setService('shacharit'); setEditing(null); } }} />
        <Text style={s.muted}>{template.regularCount} עליות{service === 'shacharit' ? ' ומפטיר' : ''}{template.allowExtra ? ' · אפשר להוסיף עליות' : ' · בחג אין להוסיף עליות'}</Text>
        {slots.map(slot => {
          const options = aliyahChoices(slot, people);
          const old = editing?.calls.find(call => call.position === slot.position);
          if (old?.personId && !options.some(option => option.value === `person:${old.personId}`)) options.push({ value: `person:${old.personId}`, label: old.nameAtRecording || 'עולה שנשמר ברשומה' });
          return <Choice key={slot.position} label={aliyahLabel(slot.position)} value={selected[slot.position] || ''} options={options} disabled={busy || loading} onChange={value => setSelected(previous => ({ ...previous, [slot.position]: value }))} />;
        })}
        {template.allowExtra && <View style={s.row}><View style={{ flex: 1 }}><Button title="+ הוספת עלייה" secondary disabled={busy || loading || slots.length >= 100} onPress={() => setExtras(value => value + 1)} /></View>{extras > 0 && <View style={{ flex: 1 }}><Button title="הסרת העלייה הנוספת" secondary disabled={busy || loading} onPress={() => setExtras(value => value - 1)} /></View>}</View>}
        <Button title={editing ? 'שמירת תיקון העליות' : 'שמירת העליות'} busy={busy} disabled={loading || !reading || slots.some(slot => !selected[slot.position])} onPress={() => void save()} />
        {editing && <Button title="רישום שבת או חג נוספים" secondary disabled={busy} onPress={() => { setEditing(null); setNotice(null); setRevision(value => value + 1); }} />}
      </>}
      <ErrorText error={error} />{notice && <Text accessibilityRole="alert" style={s.text}>{notice}</Text>}
    </View>
    <Text style={s.heading}>רישומים שנשמרו</Text>
    {records.map(record => <View key={record.id} style={s.card}>
      <Text style={s.heading}>{record.reading}</Text><Text style={s.muted}>{record.date} · {record.hebrewDate} · מניין {record.minyan || 1}{record.cancelled ? ' · מבוטל' : ''}</Text>
      {record.calls.map(call => <Text key={call.position} style={s.text}>{aliyahLabel(call.position)}: {call.guest ? 'אורח' : call.nameAtRecording}</Text>)}
      <Button title={`תיקון ${record.service === 'mincha' ? 'מנחה' : 'שחרית'} · ${record.date} · מניין ${record.minyan || 1}`} secondary disabled={busy} onPress={() => { setDay(record.date); setService(record.service); setMinyan(record.minyan || 1); setEditing(record); setNotice(null); scroll.current?.scrollTo({ y: 0, animated: true }); }} />
    </View>)}
  </ScrollView>;
}
