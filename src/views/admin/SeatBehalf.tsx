// UX-DESIGN §16 / §15.6: a gabbai sets a household's released seats on its behalf, any time. Counts and shapes only, no seat numbers:
// each seat is "<block> · row r · seat k of n" with two chips. Pure payload logic is in src/seats/wire.ts (tested).
import React from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, Chip, Field, Segmented, Txt, useTokens } from '../../kit/components.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { Prayer } from '../../seats/release.ts';
import { householdsOf, lastBy, onBehalfBody, releasedNow } from '../../seats/wire.ts';
import type { Household, WeekWire } from '../../seats/wire.ts';

const LIST_MAX = 30;
const PRAYERS: Prayer[] = ['arvit', 'shacharit'];

export type BehalfSave = (bodies: Array<{ prayer: Prayer; body: NonNullable<ReturnType<typeof onBehalfBody>> }>) => Promise<{ ok: boolean; stale?: boolean; error?: string }>;

export function SeatBehalf({ week, selected, onSelect, save }: { week: WeekWire; selected: string | null; onSelect: (ref: string | null) => void; save: BehalfSave }) {
  const { t } = useI18n();
  const k = useTokens();
  const households = React.useMemo(() => householdsOf(week), [week]);
  const [query, setQuery] = React.useState('');
  const [prayer, setPrayer] = React.useState<Prayer>('arvit');
  const household = households.find(h => h.ref === selected) ?? null;
  const [draft, setDraft] = React.useState<Record<Prayer, Set<string>>>({ arvit: new Set(), shacharit: new Set() });
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  // A fresh week (after a save or a re-read) or another household replaces the draft.
  React.useEffect(() => {
    setDraft(household ? { arvit: releasedNow(week, 'arvit', household), shacharit: releasedNow(week, 'shacharit', household) } : { arvit: new Set(), shacharit: new Set() });
  }, [week, household]);
  React.useEffect(() => { setNote(null); }, [selected]);

  const matches = React.useMemo(() => households.filter(h => !query.trim() || h.name.includes(query.trim())), [households, query]);

  function toggle(id: string) {
    setNote(null);
    setDraft(d => { const next = new Set(d[prayer]); if (next.has(id)) next.delete(id); else next.add(id); return { ...d, [prayer]: next }; });
  }
  const bodies = household ? PRAYERS.flatMap(p => { const body = onBehalfBody(week, p, household, draft[p]); return body ? [{ prayer: p, body }] : []; }) : [];

  async function submit() {
    if (!household || busy) return;
    if (!bodies.length) { setNote({ tone: 'info', text: t('seats.behalf.noChange') }); return; }
    setBusy(true); setNote(null);
    try {
      const r = await save(bodies);
      if (r.ok) setNote({ tone: 'info', text: t('seats.behalf.saved') });
      else setNote({ tone: r.stale ? 'info' : 'error', text: r.stale ? t('seats.behalf.stale') : r.error ?? '' });
    } finally { setBusy(false); }
  }

  const by = household ? lastBy(week, prayer, household) : null;
  return (
    <Card style={{ gap: 10, maxWidth: 680, width: '100%' }}>
      <Txt bold size="heading" accessibilityRole="header">{t('seats.behalf.title')}</Txt>
      <Txt size="small" color={k.muted}>{t('seats.behalf.sub')}</Txt>
      {household ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <Txt bold>{t('seats.behalf.for', { name: household.name })}</Txt>
            <Chip label={t('seats.behalf.close')} onPress={() => onSelect(null)} />
          </View>
          {!week.open ? <Banner tone="info" text={t('seats.behalf.pastDeadline')} /> : null}
          <Segmented<Prayer> options={PRAYERS.map(p => ({ key: p, label: t(`seats.${p}`) }))} value={prayer} onChange={setPrayer} />
          {by ? <Txt size="caption" color={k.muted}>{by === 'gabbai' ? t('seats.behalf.byGabbai') : t('seats.behalf.byMember')}</Txt> : null}
          {household.seats.map(s => {
            const free = draft[prayer].has(s.id);
            const line = t('seats.behalf.seatLine', { block: s.blockName, row: s.rowLabel ?? '–', k: s.k, n: s.n });
            return (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <Txt size="small" style={{ flexShrink: 1 }}>{line}</Txt>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Chip label={t('seats.coming')} selected={!free} onPress={() => { if (free) toggle(s.id); }} accessibilityLabel={`${line}, ${t('seats.coming')}`} />
                  <Chip label={t('seats.notComing')} selected={free} onPress={() => { if (!free) toggle(s.id); }} accessibilityLabel={`${line}, ${t('seats.notComing')}`} />
                </View>
              </View>
            );
          })}
          <Txt size="caption" color={k.muted}>{t('seats.behalf.note')}</Txt>
          {note ? <Banner tone={note.tone} text={note.text} /> : null}
          <Button title={t('seats.behalf.save')} busy={busy} onPress={() => void submit()} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Field label={t('seats.behalf.search')} value={query} onChangeText={setQuery} />
          <Txt size="caption" color={k.muted}>{t('seats.behalf.tapHint')}</Txt>
          {matches.length === 0 ? <Txt size="small" color={k.muted}>{t('seats.behalf.none')}</Txt> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {matches.slice(0, LIST_MAX).map((h: Household) => (
              <Chip key={h.ref} label={`${h.name} · ${t('seats.behalf.seatsCount', { n: h.seats.length })}`} onPress={() => onSelect(h.ref)} />
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}
