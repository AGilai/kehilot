import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Text, View } from 'react-native';
import { api } from '../api';
import { formatCivilDate } from '../dates';
import { healingPrayersHtml } from '../healingPrayersReport';
import { printHtml } from '../printHtml';
import { useCommunity } from '../state';
import type { HealingPrayer } from '../types';
import { Button, C, ErrorText, s } from '../ui';

export function GabbaiHealingPrayers({ onClose }: { onClose: () => void }) {
  const { session } = useCommunity();
  const [entries, setEntries] = useState<HealingPrayer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const request = useRef(0);
  const printBusy = useRef(false);
  const load = useCallback(async () => {
    if (!session) return;
    const current = ++request.current;
    setLoading(true); setError(null);
    try {
      const rows = await api.adminHealingPrayers(session.token);
      if (active.current && current === request.current) { setEntries(rows); setLoaded(true); }
    } catch (e) {
      if (active.current && current === request.current) setError(e instanceof Error ? e.message : 'טעינת רשימת החולים נכשלה.');
    } finally { if (active.current && current === request.current) setLoading(false); }
  }, [session?.token]);
  useEffect(() => {
    active.current = true; void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && !printBusy.current) void load(); });
    return () => { active.current = false; ++request.current; subscription.remove(); };
  }, [load]);
  async function print() {
    if (!session || printBusy.current) return;
    printBusy.current = true; ++request.current; setPrinting(true); setError(null);
    try {
      await printHtml(async nativeMargins => {
        const latest = await api.adminHealingPrayers(session.token);
        if (active.current) { setEntries(latest); setLoaded(true); }
        if (!latest.length) throw new Error('אין כרגע שמות למי שברך לחולים. הרשימה עודכנה.');
        return healingPrayersHtml(latest, nativeMargins);
      });
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'לא ניתן לפתוח את אפשרויות ההדפסה.'); }
    finally { printBusy.current = false; if (active.current) setPrinting(false); }
  }
  return <FlatList style={s.page} contentContainerStyle={s.content} data={entries} keyExtractor={entry => entry.id}
    refreshing={loading && loaded} onRefresh={() => { if (!printing) void load(); }}
    ListHeaderComponent={<View style={{ gap: 20 }}>
      <Button title="חזרה לכלי הגבאי" secondary disabled={printing} onPress={onClose} />
      <Text style={s.title}>מי שברך לחולים</Text>
      <Text style={s.text}>השמות שהוסיפו כל המתפללים לתפילה לרפואה שלמה.</Text>
      <Button title="רענון רשימת החולים" secondary busy={loading} disabled={printing} onPress={() => void load()} />
      <Button title="הדפסת רשימת החולים" busy={printing} disabled={loading || !loaded || !entries.length} onPress={() => void print()} />
      <Text style={s.muted}>להדפסה מופיעים שמות התפילה בלבד.</Text>
      <ErrorText error={error} />
      {loading && !loaded && <ActivityIndicator color={C.green} />}
      {loaded && <Text style={s.heading}>{entries.length === 1 ? 'שם אחד' : `${entries.length} שמות`}</Text>}
    </View>}
    ListEmptyComponent={loaded && !loading ? <View style={s.card}><Text style={s.text}>אין כרגע שמות למי שברך לחולים.</Text></View> : null}
    renderItem={({ item }) => <View style={s.card}>
      <Text selectable style={s.heading}>{item.name}</Text>
      <Text style={s.muted}>נוסף על ידי: {item.memberName || 'שם המתפלל לא הוזן'}</Text>
      <Text style={s.muted}>{item.reminder?.confirmedOn ? 'אישור אחרון' : 'תאריך הוספה'}: {formatCivilDate(item.addedOn)}</Text>
    </View>}
  />;
}
