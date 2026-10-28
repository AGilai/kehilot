import React from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { config } from '../config.ts';
import { hebrewDate } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Segmented, Sheet, Tag, Txt, useTokens } from '../kit/components.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { useReportPad } from '../client/reportUi.ts';
import { fonts } from '../kit/theme.ts';
import { releaseCounts, toggleRelease } from '../seats/release.ts';
import type { Prayer } from '../seats/release.ts';
import { useMemberSeats } from '../seats/useMemberSeats.ts';
import { useShabbat } from '../seats/useShabbat.ts';
import { whenParts } from '../seats/window.ts';
import type { MemberSeats, SeatFrame, SeatRow } from '../seats/wire.ts';
import { BackLink } from './Me.tsx';
import { useErrorText } from './auth/Frame.tsx';

const ROW_NO = 40;
const HATCH = 'repeating-linear-gradient(135deg, rgba(128,134,160,.45) 0 4px, transparent 4px 9px)';

/** P25: the member's seat page (UX-DESIGN §15.3), on the member API. It gets only its own cut (`frames`): there is no whole-hall map here, by design. */
export function SeatPage({ week, onBack, onToast }: { /** The Friday of the Shabbat to show; the server's coming one when absent. */ week?: string; onBack: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const seats = useMemberSeats(true, week);
  const errText = useErrorText();
  const head = (back: () => void) => <BackLink onPress={back} />;
  if (seats.state.status === 'loading') {
    return <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>{head(onBack)}<ActivityIndicator /></PadScroll>;
  }
  if (seats.state.status === 'error') {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {head(onBack)}
        <Banner tone="error" text={`${t('seats.loadError')} ${errText(seats.state.code)}`} action={{ title: t('common.retry'), onPress: seats.reload }} />
      </PadScroll>
    );
  }
  return <SeatPageReady data={seats.state.data} save={seats.save} onBack={onBack} onToast={onToast} />;
}

function SeatPageReady({ data, save, onBack, onToast }: { data: MemberSeats; save: ReturnType<typeof useMemberSeats>['save']; onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const [prayer, setPrayer] = React.useState<Prayer>('arvit');
  const initial = data.released;
  const [released, setReleased] = React.useState<Record<Prayer, Set<string>>>(() => ({ arvit: new Set(initial.arvit), shacharit: new Set(initial.shacharit) }));
  // A fresh server state (after a save or a re-read) replaces the draft.
  React.useEffect(() => { setReleased({ arvit: new Set(initial.arvit), shacharit: new Set(initial.shacharit) }); }, [initial]);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false);
  const { saturday, parasha } = useShabbat(data.week);
  const deadline = whenParts(data.deadline, lang);
  const differs = (p: Prayer) => released[p].size !== initial[p].size || [...released[p]].some(x => !initial[p].has(x));
  const dirty = differs('arvit') || differs('shacharit');
  const unanswered = !(data.answered.arvit && data.answered.shacharit); // saving with no change is still the answer
  const locked = !data.open;
  const pad = useReportPad(); // the dev report pill sits above the tabs: keep Save clear of it

  const label = (p: Prayer) => t(`seats.${p}`);
  const counts = releaseCounts(data.seatCount, released[prayer]);

  function tap(key: string) {
    if (locked || busy) return;
    setStale(false);
    setReleased(r => ({ ...r, [prayer]: toggleRelease(r[prayer], key) }));
  }
  function back() { if (dirty) setConfirmLeave(true); else onBack(); }

  async function submit() {
    if (busy || (!dirty && !unanswered)) return;
    setBusy(true); setError(null); setStale(false);
    try {
      const choices = Object.fromEntries((['arvit', 'shacharit'] as Prayer[]).filter(p => differs(p) || !data.answered[p]).map(p => [p, released[p]]));
      const r = await save(choices);
      if (r?.kind === 'updated') setStale(true); // somebody else changed his seats: the page now shows the current state
      else if (r) onToast(t('seats.saved'));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const head = (
    <>
      <BackLink onPress={back} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Txt serif size="title" accessibilityRole="header">{t('seats.title')}</Txt>
        {config.seatsPreview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
      </View>
      <Txt size="small" color={k.muted} style={{ marginTop: -8 }}>{parasha ? t('seats.shabbatLine', { parasha, date: hebrewDate(saturday, lang) }) : hebrewDate(saturday, lang)}</Txt>
    </>
  );

  if (data.seatCount === 0) {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {head}
        <Card edgeColor={k.tekhelet}>
          <Txt bold size="heading" accessibilityRole="header">{t('seats.noneTitle')}</Txt>
          <Txt color={k.muted}>{t('seats.noneBody')}</Txt>
        </Card>
      </PadScroll>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <PadScroll contentContainerStyle={{ padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {head}
        {locked ? <Banner tone="info" text={t('seats.closed', deadline)} /> : stale ? <Banner tone="info" text={t('seats.updatedNow')} /> : data.updatedByGabbai ? <Banner tone="info" text={t(data.updatedByRole === 'tech' ? 'seats.byTech' : 'seats.byGabbai')} /> : null}
        {error ? <Banner tone="error" text={error} /> : null}
        <Segmented<Prayer> options={[{ key: 'arvit', label: label('arvit') }, { key: 'shacharit', label: label('shacharit') }]} value={prayer} onChange={setPrayer} />
        <Txt size="small">{t('seats.summary', { prayer: t(`seats.${prayer}Short`), need: counts.need, free: counts.free })}</Txt>
        {data.frames.length > 1 ? <Txt size="small" color={k.muted}>{t('seats.split')}</Txt> : null}
        {data.frames.map(f => (
          <FrameCard key={f.id} frame={f} released={released[prayer]} locked={locked} onTap={tap} showZoom={f === data.frames[data.frames.length - 1]} />
        ))}
      </PadScroll>
      {locked ? null : (
        <View style={{ borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.stone, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 + pad, gap: 6 }}>
          <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', gap: 6 }}>
            <Txt size="caption" color={k.muted} style={{ textAlign: 'center' }}>{t('seats.deadline', deadline)}</Txt>
            <Button title={t('seats.save')} busy={busy} disabled={!dirty && !unanswered} onPress={() => void submit()} />
          </View>
        </View>
      )}
      <Sheet visible={confirmLeave} title={t('seats.discardTitle')} onClose={() => setConfirmLeave(false)} closeLabel={t('seats.discardKeep')}
        footer={<Button kind="danger" title={t('seats.discardYes')} onPress={() => { setConfirmLeave(false); onBack(); }} />}>
        <Txt color={k.muted}>{t('seats.discardBody')}</Txt>
      </Sheet>
    </View>
  );
}

const rangeText = (f: SeatFrame): string => {
  const a = f.rowFrom ?? '', b = f.rowTo ?? '';
  return a === b ? a : `${a}–${b}`;
};

function FrameCard({ frame, released, locked, onTap, showZoom }: { frame: SeatFrame; released: ReadonlySet<string>; locked: boolean; onTap: (key: string) => void; showZoom: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const mine = frame.rows.filter(r => r.mine);
  const only = mine.length === 1 ? mine[0]! : null;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Txt bold accessibilityRole="header">{t('seats.block', { block: frame.blockName, range: rangeText(frame) })}</Txt>
        {only?.label ? <Txt size="small" color={k.muted}>{t('seats.row', { n: only.label })}</Txt> : null}
      </View>
      <View style={{ backgroundColor: k.stone, borderWidth: 1, borderColor: k.line, borderRadius: 12, padding: 10, gap: 6 }}>
        <Txt size="caption" bold color={k.muted} style={{ textAlign: 'center' }}>{t('seats.toArk')}</Txt>
        <View style={{ gap: 6, width: '100%', maxWidth: Math.min(380, frame.cols * 76 + ROW_NO), alignSelf: 'center' }}>
          {frame.rows.map((r, i) => <Row key={i} row={r} named={r.bimah && !frame.rows[i - 1]?.bimah} frame={frame} released={released} locked={locked} onTap={onTap} />)}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, columnGap: 14 }}>
        <Legend swatch={<View style={{ width: 16, height: 14, borderRadius: 4, backgroundColor: k.tekhelet }} />} text={t('seats.legendComing')} />
        <Legend swatch={<View style={{ width: 16, height: 14, borderRadius: 4, borderWidth: 2, borderStyle: 'dashed', borderColor: k.tekhelet }} />} text={t('seats.legendFree')} />
        <Legend swatch={<View style={{ width: 16, height: 14, borderRadius: 4, backgroundColor: k.line }} />} text={t('seats.legendOthers')} />
      </View>
      {showZoom ? <Txt size="caption" color={k.muted}>{t('seats.zoom')}</Txt> : null}
    </Card>
  );
}

function Legend({ swatch, text }: { swatch: React.ReactNode; text: string }) {
  const k = useTokens();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{swatch}<Txt size="caption" color={k.muted}>{text}</Txt></View>;
}

function Row({ row, named, frame, released, locked, onTap }: { row: SeatRow; /** First bimah row of a stack: carries the word "בימה". */ named: boolean; frame: SeatFrame; released: ReadonlySet<string>; locked: boolean; onTap: (key: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const tile = { flex: 1, minHeight: 48, borderRadius: 8 } as const;
  // The bimah is the layout's own cells: a run of bimah cells in a row is one hatched bar, never the whole row.
  const items: Array<{ cell: SeatRow['cells'][number]; span: number; at: number }> = [];
  row.cells.forEach((c, i) => {
    const prev = items[items.length - 1];
    if (c.kind === 'bimah' && prev && prev.cell.kind === 'bimah') prev.span++; else items.push({ cell: c, span: 1, at: i });
  });
  const seated = row.cells.some(c => c.kind === 'mine' || c.kind === 'other');
  return (
    // The hall does not mirror: seat 1 is on the right in either language, and the row number sits on the right (the start side in Hebrew).
    <View style={{ flexDirection: 'row', gap: 6, direction: 'ltr' }}>
      {items.map(({ cell: c, span, at }) => {
        if (c.kind === 'bimah') {
          return (
            <View key={at} style={[tile, { flex: span, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: k.line, ...(Platform.OS === 'web' ? ({ backgroundImage: HATCH } as object) : null) }]}>
              {named ? <Txt size="small" bold color={k.muted}>{t('seats.bimah')}</Txt> : null}
            </View>
          );
        }
        if (c.kind === 'gap') return <View key={at} style={tile} />;
        if (c.kind === 'other') return <View key={at} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[tile, { backgroundColor: k.line }]} />;
        const free = released.has(c.key);
        const a11y = t(free ? 'seats.seatLabelFree' : 'seats.seatLabelComing', { block: frame.blockName, row: row.label ?? '', k: c.k, n: c.n });
        return (
          <Pressable key={at} accessibilityRole="switch" accessibilityState={{ checked: !free, disabled: locked }} accessibilityLabel={a11y} disabled={locked} onPress={() => onTap(c.key)}
            style={[tile, { alignItems: 'center', justifyContent: 'center', borderWidth: 2, opacity: locked ? 0.75 : 1 },
              free ? { backgroundColor: k.surface, borderStyle: 'dashed', borderColor: k.tekhelet } : { backgroundColor: k.tekhelet, borderColor: k.tekhelet }]}>
            <Txt size="caption" bold color={free ? k.tekhelet : k.onAction} style={{ textAlign: 'center', lineHeight: 16, fontFamily: fonts.uiBold }}>{free ? t('seats.notComing') : `✓ ${t('seats.coming')}`}</Txt>
          </Pressable>
        );
      })}
      <View style={{ width: ROW_NO, alignItems: 'center', justifyContent: 'center' }}>
        {seated ? <Txt size="caption" bold={row.mine} color={row.mine ? k.tekhelet : k.muted} style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }}>{row.label ?? ''}</Txt> : null}
      </View>
    </View>
  );
}
