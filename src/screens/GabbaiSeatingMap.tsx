import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { api } from '../api';
import { printHtml } from '../printHtml';
import { seatBackground, seatTextFit, seatingMapHtml, uniformSeatLayout, SEAT_MAP_SIDE_MARGIN_MM } from '../seatingMapReport';
import { useCommunity } from '../state';
import type { PrayerSeatMap, SeatMapLayout, SeatingMap } from '../types';
import { Button, Choice, ErrorText, s } from '../ui';

function MapCanvas({ layout, map, zoom, freeColor }: { layout: SeatMapLayout; map: PrayerSeatMap; zoom: number; freeColor: string }) {
  const states = new Map(map.cells.map(cell => [cell.cellId, cell]));
  const vertical = zoom * .85;
  return <ScrollView horizontal style={{ direction: 'ltr' }}><View style={{ width: layout.width * zoom, height: layout.height * vertical, direction: 'ltr' }}>
    {layout.cells.map(cell => {
      const state = states.get(cell.id);
      if (!state) return null;
      const font = 10;
      const fit = seatTextFit(state.label, cell.width, font);
      return <View key={cell.id} accessible accessibilityLabel={`${cell.id}: ${state.label}`} style={{ position: 'absolute', left: cell.x*zoom, top: cell.y*vertical, width: cell.width*zoom, height: cell.height*vertical,
        backgroundColor: seatBackground(cell, state.available, freeColor), borderColor: '#222', borderTopWidth: cell.borders[0] ? .5 : 0, borderRightWidth: cell.borders[1] ? .5 : 0, borderBottomWidth: cell.borders[2] ? .5 : 0, borderLeftWidth: cell.borders[3] ? .5 : 0,
        alignItems: 'center', justifyContent: 'center' }}>
        <Text numberOfLines={1} style={{ color: cell.color, fontSize: font*zoom, lineHeight: font*zoom*1.05, width: fit.width*zoom, transform: [{ scaleX: fit.scaleX }], includeFontPadding: false, fontWeight: cell.bold ? '700' : '400', textAlign: 'center', writingDirection: 'rtl' }}>{state.label}</Text>
      </View>;
    })}
  </View></ScrollView>;
}

export function GabbaiSeatingMap({ onClose }: { onClose: () => void }) {
  const { session } = useCommunity();
  const [report, setReport] = useState<SeatingMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [zoom, setZoom] = useState('fit');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), sequence = useRef(0), printBusy = useRef(false);
  const window = useWindowDimensions();
  const load = useCallback(async () => {
    if (!session || printBusy.current) return;
    const request = ++sequence.current; setLoading(true);
    try { const fresh = await api.seatingMap(session.token); if (mounted.current && request === sequence.current) { setReport(fresh); setError(null); } }
    catch (e) { if (mounted.current && request === sequence.current) setError(e instanceof Error ? e.message : 'טעינת המפה נכשלה.'); }
    finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }, [session?.token]);
  useEffect(() => {
    mounted.current = true; void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 30000);
    const active = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { mounted.current = false; ++sequence.current; clearInterval(timer); active.remove(); };
  }, [load]);
  async function print() {
    if (!session || printBusy.current) return;
    printBusy.current = true; ++sequence.current; setPrinting(true); setLoading(false); setError(null);
    try { await printHtml(async native => { const fresh = await api.seatingMap(session.token); if (mounted.current) setReport(fresh); return seatingMapHtml(fresh, native); }, { orientation: 'landscape', horizontalMarginMm: SEAT_MAP_SIDE_MARGIN_MM }); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'לא ניתן להדפיס את המפה.'); }
    finally { printBusy.current = false; if (mounted.current) setPrinting(false); }
  }
  const layout = useMemo(() => report?.layout ? uniformSeatLayout(report.layout) : null, [report?.layout]);
  const scale = layout ? zoom === 'fit' ? Math.min(1, (window.width - 44)/layout.width) : Number(zoom) : 1;
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Button title="חזרה לכלי הגבאי" secondary disabled={printing} onPress={onClose} />
    <Text style={s.title}>מפת מקומות לשבת ולחג</Text>
    {report && <Text style={s.heading}>{report.event.title}</Text>}
    <Button title="רענון מפת המקומות" secondary busy={loading} disabled={printing} onPress={() => void load()} />
    <Button title="הדפסת שתי המפות" busy={printing} disabled={!layout || loading} onPress={() => void print()} />
    <ErrorText error={error} />
    {report && !layout && <Text style={s.text}>מפת המקומות טרם נטענה למערכת.</Text>}
    {layout && <><Choice label="גודל התצוגה" value={zoom} options={[{ value: 'fit', label: 'מפה מלאה' }, { value: '.75', label: '75%' }, { value: '1', label: '100%' }, { value: '1.25', label: '125%' }]} onChange={setZoom} />
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}><View style={{ width: 18, height: 18, backgroundColor: report?.freeColor || '#6AA84F' }} /><Text style={s.text}>פנוי</Text></View>
      {report?.maps.map(map => <View key={map.prayer} style={{ gap: 10 }}><Text style={s.heading}>{map.title} · {map.freeSeats} מקומות פנויים</Text><MapCanvas layout={layout} map={map} zoom={scale} freeColor={report.freeColor || '#6AA84F'} /></View>)}
      {report?.warnings.map(warning => <Text key={warning} style={s.error}>{warning}</Text>)}
    </>}
  </ScrollView>;
}
