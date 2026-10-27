import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { FixtureMemberSeats } from '../client/fixtures.ts';
import { hebrewDate } from '../dates.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Segmented, Sheet, Tag, Txt, useTokens } from '../kit/components.tsx';
import { PadScroll } from '../kit/PadScroll.tsx';
import { useReportPad } from '../client/reportUi.ts';
import { fonts } from '../kit/theme.ts';
import type { Frame, FrameRow } from '../seats/frame.ts';
import { releaseCounts, toggleRelease } from '../seats/release.ts';
import type { Prayer } from '../seats/release.ts';
import { useShabbat } from '../seats/useShabbat.ts';
import { cardWindow, whenParts } from '../seats/window.ts';
import { BackLink } from './Me.tsx';

const ROW_NO = 40;
const HATCH = 'repeating-linear-gradient(135deg, rgba(128,134,160,.45) 0 4px, transparent 4px 9px)';

/** P25: the member's seat page (UX-DESIGN §15.3). It gets only its own cut (`data.frames`): there is no whole-hall map here, by design. */
export function SeatPage({ data, onBack, onToast }: { data: FixtureMemberSeats; onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const [prayer, setPrayer] = React.useState<Prayer>('arvit');
  const initial = React.useMemo(() => ({ arvit: new Set(data.answers.arvit), shacharit: new Set(data.answers.shacharit) }), [data]);
  const [released, setReleased] = React.useState<Record<Prayer, Set<string>>>(initial);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const { friday, saturday, parasha } = useShabbat();
  const deadline = whenParts(cardWindow(friday).closesAt, lang);
  const dirty = (['arvit', 'shacharit'] as Prayer[]).some(p => released[p].size !== initial[p].size || [...released[p]].some(x => !initial[p].has(x)));
  const locked = data.closed;
  const pad = useReportPad(); // the dev report pill sits above the tabs: keep Save clear of it

  const label = (p: Prayer) => t(`seats.${p}`);
  const counts = releaseCounts(data.seatCount, released[prayer]);

  function tap(key: string) {
    if (locked) return;
    setReleased(r => ({ ...r, [prayer]: toggleRelease(r[prayer], key) }));
  }
  function back() { if (dirty) setConfirmLeave(true); else onBack(); }

  const head = (
    <>
      <BackLink onPress={back} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Txt serif size="title" accessibilityRole="header">{t('seats.title')}</Txt>
        <Tag tone="preview" label={t('seats.preview')} />
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
        {locked ? <Banner tone="info" text={t('seats.closed', deadline)} /> : data.source === 'gabbai' ? <Banner tone="info" text={t('seats.byGabbai')} /> : null}
        <Segmented<Prayer> options={[{ key: 'arvit', label: label('arvit') }, { key: 'shacharit', label: label('shacharit') }]} value={prayer} onChange={setPrayer} />
        <Txt size="small">{t('seats.summary', { prayer: t(`seats.${prayer}Short`), need: counts.need, free: counts.free })}</Txt>
        {data.frames.length > 1 ? <Txt size="small" color={k.muted}>{t('seats.split')}</Txt> : null}
        {data.frames.map(f => (
          <FrameCard key={`${f.blockId}:${f.rowFrom}`} frame={f} released={released[prayer]} locked={locked} onTap={tap} showZoom={f === data.frames[data.frames.length - 1]} />
        ))}
      </PadScroll>
      {locked ? null : (
        <View style={{ borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.stone, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 + pad, gap: 6 }}>
          <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', gap: 6 }}>
            <Txt size="caption" color={k.muted} style={{ textAlign: 'center' }}>{t('seats.deadline', deadline)}</Txt>
            <Button title={t('seats.save')} onPress={() => onToast(t('seats.previewToast'))} />
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

function FrameCard({ frame, released, locked, onTap, showZoom }: { frame: Frame; released: ReadonlySet<string>; locked: boolean; onTap: (key: string) => void; showZoom: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const mine = frame.rows.filter(r => r.mine);
  const only = mine.length === 1 ? mine[0]! : null;
  // Consecutive bimah rows draw as one bar.
  const rows = frame.rows.filter((r, i) => !(r.bimah && frame.rows[i - 1]?.bimah));
  const rowName = (n: number | null) => (n === null ? t('seats.frontShort') : String(n));
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Txt bold accessibilityRole="header">{t('seats.block', { block: frame.blockName, range: `${rowName(frame.rowFrom === 0 ? null : frame.rowFrom)}–${rowName(frame.rowTo === 0 ? null : frame.rowTo)}` })}</Txt>
        {only ? <Txt size="small" color={k.muted}>{only.label === null ? t('seats.frontRow') : t('seats.row', { n: only.label })}</Txt> : null}
      </View>
      <View style={{ backgroundColor: k.stone, borderWidth: 1, borderColor: k.line, borderRadius: 12, padding: 10, gap: 6 }}>
        <Txt size="caption" bold color={k.muted} style={{ textAlign: 'center' }}>{t('seats.toArk')}</Txt>
        <View style={{ gap: 6, width: '100%', maxWidth: Math.min(380, frame.cols * 76 + ROW_NO), alignSelf: 'center' }}>
          {rows.map(r => <Row key={r.row} row={r} frame={frame} released={released} locked={locked} onTap={onTap} />)}
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

function Row({ row, frame, released, locked, onTap }: { row: FrameRow; frame: Frame; released: ReadonlySet<string>; locked: boolean; onTap: (key: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const tile = { flex: 1, minHeight: 48, borderRadius: 8 } as const;
  return (
    // The hall does not mirror: seat 1 is on the right in either language, and the row number sits on the right (the start side in Hebrew).
    <View style={{ flexDirection: 'row', gap: 6, direction: 'ltr' }}>
      {row.bimah ? (
        <View style={[tile, { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: k.line, ...(Platform.OS === 'web' ? ({ backgroundImage: HATCH } as object) : null) }]}>
          <Txt size="small" bold color={k.muted}>{t('seats.bimah')}</Txt>
        </View>
      ) : row.cells.map((c, i) => {
        if (c.kind === 'gap' || c.kind === 'bimah') return <View key={i} style={tile} />;
        if (c.kind === 'other') return <View key={i} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[tile, { backgroundColor: k.line }]} />;
        const free = released.has(c.key);
        const a11y = t(free ? 'seats.seatLabelFree' : 'seats.seatLabelComing', { block: frame.blockName, row: row.label ?? t('seats.frontShort'), n: c.seatNo });
        return (
          <Pressable key={i} accessibilityRole="switch" accessibilityState={{ checked: !free, disabled: locked }} accessibilityLabel={a11y} disabled={locked} onPress={() => onTap(c.key)}
            style={[tile, { alignItems: 'center', justifyContent: 'center', borderWidth: 2, opacity: locked ? 0.75 : 1 },
              free ? { backgroundColor: k.surface, borderStyle: 'dashed', borderColor: k.tekhelet } : { backgroundColor: k.tekhelet, borderColor: k.tekhelet }]}>
            <Txt size="caption" bold color={free ? k.tekhelet : k.onAction} style={{ textAlign: 'center', lineHeight: 16, fontFamily: fonts.uiBold }}>{free ? t('seats.notComing') : `✓ ${t('seats.coming')}`}</Txt>
            <Txt size="caption" color={free ? k.tekhelet : k.onAction} style={{ textAlign: 'center', lineHeight: 15, fontSize: 11.5 }}>{t('seats.seatNo', { n: c.seatNo })}</Txt>
          </Pressable>
        );
      })}
      <View style={{ width: ROW_NO, alignItems: 'center', justifyContent: 'center' }}>
        {row.bimah ? null : <Txt size="caption" bold={row.mine} color={row.mine ? k.tekhelet : k.muted} style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }}>{row.label ?? t('seats.frontShort')}</Txt>}
      </View>
    </View>
  );
}
