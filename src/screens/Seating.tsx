import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { loadShabbat } from '../api';
import { civilDate, displayDate, TZ } from '../dates';
import type { PrayerSeats } from '../types';
import { initialSeatValue, seatContextKey, seatOptions } from '../seating';
import { useCommunity } from '../state';
import { Button, C, Choice, ErrorText, s } from '../ui';

export function Seating({ onClose }: { onClose: () => void }) {
  const { data, isDemo, refresh, saveSeating } = useCommunity();
  const status = data?.seating;
  const key = status ? seatContextKey(status) : '';
  const [draft, setDraft] = useState({ key: '', arvit: '', shacharit: '' });
  const [demoTitle, setDemoTitle] = useState<{ key: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setNotice(null); }, [key]);
  useEffect(() => {
    if (!isDemo || !status || status.event.occasion === 'high_holidays') return;
    let active = true;
    const friday = civilDate(status.event.date);
    friday.setUTCDate(friday.getUTCDate() - 1);
    const expected = friday.toISOString().slice(0, 10);
    void loadShabbat(expected).then(value => {
      if (active && value.friday === expected) setDemoTitle({ key, title: value.parasha + (status.event.occasion === 'zachor' ? ' · שבת זכור' : '') });
    }).catch(() => {});
    return () => { active = false; };
  }, [isDemo, key]);
  async function reload() {
    setRefreshing(true); setError(null);
    try { await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'לא ניתן לטעון את פרטי המקומות.'); }
    finally { setRefreshing(false); }
  }
  async function save() {
    if (!status || busy) return;
    const value = { arvit: draft.key === key ? draft.arvit : initialSeatValue(status, 'arvit'), shacharit: draft.key === key ? draft.shacharit : initialSeatValue(status, 'shacharit') };
    if (value.arvit === '' || value.shacharit === '') { setError('יש לבחור מספר מקומות.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try { await saveSeating({ arvit: Number(value.arvit), shacharit: Number(value.shacharit) }, status); setNotice('דיווח המקומות נשמר.'); }
    catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן לשמור את הדיווח.');
      await refresh().catch(() => {});
    } finally { setBusy(false); }
  }
  const selected = status ? { arvit: draft.key === key ? draft.arvit : initialSeatValue(status, 'arvit'), shacharit: draft.key === key ? draft.shacharit : initialSeatValue(status, 'shacharit') } : { arvit: '', shacharit: '' };
  const allocation = status?.allocatedSeats;
  const title = isDemo && demoTitle?.key === key ? demoTitle.title : status?.event.title;
  const holiday = status && ['holiday', 'high_holidays', 'megillah_evening'].includes(status.event.occasion);
  const unused = status?.event.mode === 'unused';
  const prayers: { key: keyof PrayerSeats; label: string }[] = [{ key: 'arvit', label: 'ערבית' }, { key: 'shacharit', label: 'שחרית' }];
  return <ScrollView style={s.page} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={C.green} />}>
    <Button title="חזרה לבית" secondary onPress={onClose} />
    <View style={{ gap: 6 }}><Text style={s.title}>מקומות לשבת ולחג</Text>{status && <><Text style={s.heading}>{title}</Text>{status.event.parasha && !title?.includes(status.event.parasha) && <Text style={s.heading}>{status.event.parasha}</Text>}<Text style={s.muted}>{displayDate(status.event.date)} · עזרת גברים</Text></>}</View>
    {!status ? <View style={s.card}><Text style={s.text}>לא ניתן לטעון את פרטי הדיווח כרגע.</Text><Button title="טעינה מחדש" secondary onPress={() => void reload()} busy={refreshing} /></View>
      : !status.eligible ? <View style={s.card}><Text style={s.text}>דיווח המקומות המשפחתי מתבצע על ידי ראש משפחה חבר עמותה, עבור כל המשפחה.</Text><Text style={s.muted}>אם פרטי החברות שלך אינם מעודכנים, אפשר לפנות לגבאי.</Text></View>
      : allocation === null ? <View style={s.card}><Text style={s.text}>טרם הוגדרה מכסת המקומות למשפחה.</Text><Text style={s.muted}>יש לפנות לגבאי להגדרת מספר המקומות המוקצים בעזרת הגברים.</Text></View>
      : <>
        <View style={s.card}>
          <Text style={s.heading}>{allocation === 1 ? 'למשפחה מוקצה מקום אחד' : `למשפחה מוקצים ${allocation} מקומות`}</Text>
          <Text style={[s.heading, { fontSize: 24 }]}>כמה מקומות {unused && <Text style={{ fontWeight: '900', color: C.red }}>לא </Text>}צריך {holiday ? 'בחג' : 'השבת'}?</Text>
          {!unused && <Text style={s.muted}>ללא דיווח לא יישמרו מקומות.</Text>}
          {status.event.closesAt && <Text style={s.muted}>סיום קבלת הדיווחים: {new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(status.event.closesAt))}</Text>}
          {!status.event.reportingOpen && <Text style={[s.text, { color: C.red }]}>קבלת הדיווחים לאירוע זה נסגרה. לשינוי יש לפנות לגבאי.</Text>}
          {status.reportInvalidated && <Text style={[s.text, { color: C.red }]}>מכסת המקומות או פרטי האירוע השתנו. יש לבחור ולשלוח דיווח חדש.</Text>}
          {prayers.map(prayer => <Choice key={prayer.key} labelSize={19}
            label={`כמה מקומות ${unused ? 'לא ' : ''}צריך בתפילת ${prayer.label}?`}
            labelContent={<>כמה מקומות {unused && <Text style={{ fontWeight: '900', color: C.red }}>לא </Text>}צריך בתפילת {prayer.label}?</>}
            value={selected[prayer.key]} options={[{ value: '', label: 'בחירת מספר' }, ...seatOptions(allocation!)]}
            disabled={busy || !status.event.reportingOpen} onChange={value => { setDraft({ key, ...selected, [prayer.key]: value }); setNotice(null); }} />)}
          <Button title="שמירת דיווח המקומות" onPress={() => void save()} busy={busy} disabled={!status.event.reportingOpen || selected.arvit === '' || selected.shacharit === ''} />
        </View>
        <View style={s.card}><Text style={s.heading}>{status.reported ? 'המקומות שנשמרו למשפחה' : 'המקומות למשפחה ללא דיווח'}</Text>{prayers.map(prayer => <Text key={prayer.key} style={s.text}>{prayer.label}: {status.neededSeats?.[prayer.key] === 1 ? 'מקום אחד' : `${status.neededSeats?.[prayer.key]} מקומות`}</Text>)}</View>
      </>}
    <ErrorText error={error} />
    {error && <Button title="רענון פרטי הדיווח" secondary onPress={() => void reload()} busy={refreshing} />}
    {notice && <Text accessibilityRole="alert" style={[s.text, { color: C.green }]}>{notice}</Text>}
    {isDemo && <Text style={s.muted}>מצב הדגמה: משפחה לדוגמה עם 4 מקומות. הדיווח נשמר במכשיר בלבד.</Text>}
  </ScrollView>;
}
