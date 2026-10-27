import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { printRecommendations } from '../printRecommendations';
import { recommendationCells, recommendationColumns, TRIBE_BACKGROUNDS } from '../recommendations';
import { useCommunity } from '../state';
import type { AliyahRecommendations, RecommendationCalendar } from '../types';
import { Button, C, Choice, ErrorText, s } from '../ui';

const WIDTHS = [78, 170, 190, 190, 120, 100, 320];
export function GabbaiRecommendations({ onClose }: { onClose: () => void }) {
  const { session, data } = useCommunity();
  const tables = useRef<Record<string, ScrollView | null>>({});
  const [calendar, setCalendar] = useState<RecommendationCalendar | null>(null);
  const [year, setYear] = useState('');
  const [day, setDay] = useState('');
  const [report, setReport] = useState<AliyahRecommendations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoadingCalendar(true); setCalendar(null); setReport(null); setError(null);
    void api.recommendationCalendar(session.token, year).then(result => {
      if (!active) return;
      setCalendar(result);
      setDay(previous => result.services.some(service => (service.key || service.date) === previous) ? previous :
        result.services.some(service => service.date === result.defaultDate) ? (result.services.find(service => service.date === result.defaultDate)!.key || result.defaultDate) : (result.services[0]!.key || result.services[0]!.date));
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'טעינת לוח הדוחות נכשלה.'); })
      .finally(() => { if (active) setLoadingCalendar(false); });
    return () => { active = false; };
  }, [session?.token, year, revision]);
  useEffect(() => {
    if (!session || !calendar || !calendar.services.some(service => (service.key || service.date) === day)) return;
    let active = true;
    setLoadingReport(true); setReport(null); setError(null);
    const selectedService = calendar.services.find(service => (service.key || service.date) === day)!;
    void api.aliyahRecommendations(session.token, selectedService.date, selectedService.service || 'shacharit').then(result => { if (active) setReport(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'טעינת המומלצים נכשלה.'); })
      .finally(() => { if (active) setLoadingReport(false); });
    return () => { active = false; };
  }, [session?.token, calendar, day, data?.communitySettings?.yahrzeitCustom]);
  async function print() {
    if (!report) return;
    setPrinting(true); setError(null);
    try { await printRecommendations(report); }
    catch (e) { setError(e instanceof Error ? e.message : 'לא ניתן לפתוח את אפשרויות ההדפסה.'); }
    finally { setPrinting(false); }
  }
  const loading = loadingCalendar || loadingReport;
  return <FlatList style={s.page} contentContainerStyle={s.content}
    data={report?.sections || []} keyExtractor={section => section.id}
    initialNumToRender={1} maxToRenderPerBatch={1} windowSize={3} removeClippedSubviews={false}
    ListHeaderComponent={<View style={{ gap: 20 }}>
      <Button title="חזרה לכלי הגבאי" secondary onPress={onClose} disabled={printing} />
      <Text style={s.title}>מומלצים לעלייה לתורה</Text>
      <View style={s.card}>
        {calendar && <>
          <Choice label="שנה עברית" value={year || String(calendar.year)} options={calendar.years} disabled={printing} onChange={value => { setYear(value); setReport(null); }} />
          <Choice label="פרשת השבוע או החג לדוח" value={day} options={calendar.services.map(service => ({ value: service.key || service.date, label: `${service.reading} · ${service.hebrewDate}` }))} disabled={printing} onChange={value => { setDay(value); setReport(null); }} />
        </>}
        <Button title="רענון המומלצים" secondary disabled={loading || printing} onPress={() => setRevision(value => value + 1)} />
        <Button title="הדפסת טופס המומלצים" busy={printing} disabled={!report || loading} onPress={() => void print()} />
        <ErrorText error={error} />
        {loading && <ActivityIndicator color={C.green} />}
      </View>
      {report && <>
        <Text style={s.heading}>{report.service.title}</Text>
        <Text style={s.muted}>{report.service.hebrewDate} · {report.service.date}</Text>
        <Text style={s.muted}>אפשר לגלול את הטבלאות לצדדים. כהנים בכחול, לוויים בזהב בהיר, ישראל בלבן.</Text>
      </>}
    </View>}
    renderItem={({ item: section }) => <View>
      <Text style={[s.heading, { marginBottom: 10 }]}>{section.title} · {section.people.length}{section.limit ? ` מתוך עד ${section.limit}` : ''}</Text>
      <ScrollView horizontal ref={node => { tables.current[section.id] = node; }}
        style={{ direction: 'ltr' }} contentContainerStyle={{ direction: 'ltr' }}
        onContentSizeChange={() => tables.current[section.id]?.scrollToEnd({ animated: false })}>
        <View style={{ width: WIDTHS.reduce((sum, width) => sum + width, 0) }}>
          <View style={{ flexDirection: 'row-reverse' }}>{recommendationColumns(section.id).map((label, index) => <Text key={label} style={{ width: WIDTHS[index], padding: 10, textAlign: 'right', writingDirection: 'rtl', backgroundColor: C.green, color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>{label}</Text>)}</View>
          {section.people.length ? section.people.map(person => <View key={person.id} style={{ flexDirection: 'row-reverse', backgroundColor: TRIBE_BACKGROUNDS[person.tribe], borderBottomWidth: 1, borderColor: C.line }}>
            {recommendationCells(person, section.id).map((value, index) => <Text key={index} style={{ width: WIDTHS[index], padding: 10, borderLeftWidth: 1, borderColor: C.line, color: C.ink, fontSize: 14, lineHeight: 22, textAlign: 'right', writingDirection: 'rtl' }}>{value}</Text>)}
          </View>) : <Text style={[s.text, { padding: 12, textAlign: 'right' }]}>אין מתפללים מתאימים ברשימה זו.</Text>}
        </View>
      </ScrollView>
    </View>}
    ListFooterComponent={<View style={{ gap: 20 }}>{report?.notes.map(note => <Text key={note} style={s.muted}>{note}</Text>)}</View>}
  />;
}
