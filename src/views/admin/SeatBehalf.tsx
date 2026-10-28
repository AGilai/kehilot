// UX-DESIGN §16 / §15.6: a gabbai sets a household's released seats on its behalf, any time. Counts and shapes only, no seat numbers:
// each seat is "<block> · row r · seat k of n" with two chips. Pure payload logic is in src/seats/wire.ts (tested).
import React from 'react';
import { Pressable, View } from 'react-native';
import { Banner, Button, Card, Chip, Field, Segmented, Sheet, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Prayer } from '../../seats/release.ts';
import { householdsOf, isPending, lastBy, onBehalfBody, releasedNow } from '../../seats/wire.ts';
import type { Household, WeekWire } from '../../seats/wire.ts';

const LIST_MAX = 30;
const PRAYERS: Prayer[] = ['arvit', 'shacharit'];

export type BehalfSave = (bodies: Array<{ prayer: Prayer; body: NonNullable<ReturnType<typeof onBehalfBody>> }>) => Promise<{ ok: boolean; stale?: boolean; error?: string }>;

type Note = { tone: 'info' | 'error' | 'success'; text: string; stale?: boolean };

/** §16.12.1. `phone`: a picked household opens in a Sheet, Save in its footer. */
/** The `seats.behalf.by…` key of who last changed a household's seats: a tech's edit reads "טכני", a gabbai's "גבאי". */
const BY_KEY = { member: 'Member', gabbai: 'Gabbai', tech: 'Tech' } as const;

export function SeatBehalf({ week, selected, onSelect, save, phone }: { week: WeekWire; selected: string | null; onSelect: (ref: string | null) => void; save: BehalfSave; phone?: boolean }) {
  const { t } = useI18n();
  const role = useSession().state.kehila?.role;
  const k = useTokens();
  const households = React.useMemo(() => householdsOf(week), [week]);
  const [query, setQuery] = React.useState('');
  const [prayer, setPrayer] = React.useState<Prayer>('arvit');
  const household = households.find(h => h.ref === selected) ?? null;
  const [draft, setDraft] = React.useState<Record<Prayer, Set<string>>>({ arvit: new Set(), shacharit: new Set() });
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<Note | null>(null);
  const noteRef = React.useRef<View>(null);
  // A fresh week (after a save or a re-read) or another household replaces the draft.
  React.useEffect(() => {
    setDraft(household ? { arvit: releasedNow(week, 'arvit', household), shacharit: releasedNow(week, 'shacharit', household) } : { arvit: new Set(), shacharit: new Set() });
  }, [week, household]);
  React.useEffect(() => { setNote(null); }, [selected]);
  // After a 409 the rows reload and focus moves to the banner.
  React.useEffect(() => { if (note?.stale) (noteRef.current as unknown as { focus?: () => void } | null)?.focus?.(); }, [note]);

  const matches = React.useMemo(() => households.filter(h => !query.trim() || h.name.includes(query.trim())), [households, query]);

  function toggle(id: string) {
    setNote(null);
    setDraft(d => { const next = new Set(d[prayer]); if (next.has(id)) next.delete(id); else next.add(id); return { ...d, [prayer]: next }; });
  }
  const bodies = household ? PRAYERS.flatMap(p => { const body = onBehalfBody(week, p, household, draft[p]); return body ? [{ prayer: p, body }] : []; }) : [];

  async function submit() {
    if (!household || busy || !bodies.length) return;
    setBusy(true); setNote(null);
    try {
      const r = await save(bodies);
      if (r.ok) setNote({ tone: 'success', text: t('seats.behalf.saved', { name: household.name }) });
      else setNote(r.stale ? { tone: 'info', text: t('seats.behalf.stale'), stale: true } : { tone: 'error', text: r.error || t('errors.generic') });
    } finally { setBusy(false); }
  }

  const count = (n: number) => (n === 1 ? t('seats.behalf.seatsCountOne') : t('seats.behalf.seatsCount', { n }));
  const by = household ? lastBy(week, prayer, household) : null;
  const sourceText = !household ? '' : by ? t(`seats.behalf.by${BY_KEY[by]}`) : isPending(week, prayer, household) ? t('seats.behalf.noAnswer') : '';
  const free = household ? draft[prayer].size : 0;
  const saveTitle = t('seats.behalf.save');
  const saveButton = (
    <Button title={saveTitle} busy={busy} disabled={!bodies.length} accessibilityLabel={bodies.length ? undefined : `${saveTitle}, ${t('seats.behalf.noChange')}`} onPress={() => void submit()} />
  );
  const rowH = phone ? 48 : 40;

  const picked = household ? (
    <View style={{ gap: 10 }}>
      {!phone ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt bold size="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>{t('seats.behalf.for', { name: household.name })}</Txt>
          <Tag label={count(household.seats.length)} />
          <View style={{ marginStart: 'auto' }}><Link label={t('seats.behalf.close')} onPress={() => onSelect(null)} /></View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Tag label={count(household.seats.length)} />
          <View style={{ marginStart: 'auto' }}><Link label={t('seats.behalf.close')} onPress={() => onSelect(null)} /></View>
        </View>
      )}
      {!week.open ? <Banner tone="info" text={t('seats.behalf.pastDeadline')} /> : null}
      <Segmented<Prayer> options={PRAYERS.map(p => ({ key: p, label: t(`seats.${p}`) }))} value={prayer} onChange={setPrayer} />
      {sourceText ? <Txt size="caption" bold color={by && by !== 'member' ? k.tekhelet : k.muted}>{sourceText}</Txt> : null}
      <View>
        {household.seats.map(s => {
          const out = draft[prayer].has(s.id);
          const line = t('seats.behalf.seatLine', { block: s.blockName, row: s.rowLabel ?? '–', k: s.k, n: s.n });
          return (
            <View key={s.id} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: k.line, paddingVertical: 6 }}>
              <Txt size="small" color={out ? k.muted : undefined} style={{ flexShrink: 1 }}>{line}</Txt>
              <View style={{ flexDirection: 'row', gap: 8, minHeight: rowH }}>
                <Chip label={t('seats.coming')} selected={!out} onPress={() => { if (out) toggle(s.id); }} accessibilityLabel={`${line}, ${t('seats.coming')}`} />
                <Chip label={t('seats.notComing')} selected={out} onPress={() => { if (!out) toggle(s.id); }} accessibilityLabel={`${line}, ${t('seats.notComing')}`} />
              </View>
            </View>
          );
        })}
      </View>
      <Txt size="small" bold>{t('seats.summary', { prayer: t(`seats.${prayer}Short`), need: household.seats.length - free, free })}</Txt>
      <Txt size="caption" color={k.muted}>{t(role === 'tech' ? 'seats.behalf.noteTech' : 'seats.behalf.note')}</Txt>
      {note ? (
        <View ref={noteRef} accessibilityLiveRegion="polite" {...({ tabIndex: -1 } as object)}><Banner tone={note.tone} text={note.text} /></View>
      ) : null}
      {phone ? null : saveButton}
    </View>
  ) : null;

  const list = (
    <View style={{ gap: 8 }}>
      <Field label={t('seats.behalf.search')} value={query} onChangeText={setQuery} />
      <Txt size="caption" color={k.muted}>{t('seats.behalf.tapHint')}</Txt>
      {households.length === 0 ? <Txt size="small" color={k.muted}>{t('seats.behalf.none')}</Txt> : matches.length === 0 ? <Txt size="small" color={k.muted}>{t('seats.behalf.noMatch')}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {matches.slice(0, LIST_MAX).map((h: Household) => (
          <Chip key={h.ref} label={`${h.name} · ${h.seats.length}`} onPress={() => onSelect(h.ref)} />
        ))}
      </View>
      {matches.length > LIST_MAX ? <Txt size="caption" color={k.muted}>{t('seats.behalf.more', { n: matches.length - LIST_MAX })}</Txt> : null}
    </View>
  );

  return (
    <>
      <Card style={{ gap: 10, maxWidth: 680, width: '100%' }}>
        {phone || !household ? (
          <>
            <Txt bold size="heading" accessibilityRole="header">{t('seats.behalf.title')}</Txt>
            <Txt size="small" color={k.muted}>{t('seats.behalf.sub')}</Txt>
          </>
        ) : null}
        {phone ? list : household ? picked : list}
      </Card>
      {phone ? <Sheet visible={!!household} title={household ? t('seats.behalf.for', { name: household.name }) : ''} onClose={() => onSelect(null)} footer={saveButton}>{picked}</Sheet> : null}
    </>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Txt bold size="small" color={k.tekhelet} style={{ textDecorationLine: 'underline' }}>{label}</Txt>
    </Pressable>
  );
}
