import React from 'react';
import { Platform, Pressable, View, useColorScheme } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Card, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { fonts } from '../../kit/theme.ts';
import { mineRowLabels } from '../../seats/seatForm.ts';
import type { SeatCell, SeatFrame, SeatRow } from '../../seats/wire.ts';
import { SeatChair } from './SeatChair.tsx';

const HATCH = 'repeating-linear-gradient(135deg, rgba(128,134,160,.45) 0 4px, transparent 4px 9px)';
const LABEL_W = 34;
const LANE_W = 18;
const GAP = 4;
/** The width from which the seat page is the wide two-column layout (the map is always open there). */
export const WIDE_MIN_WIDTH = 1024;
const MINE_H = 56;
const ROW_H = 74;
const OTHER_H = 16;

type Mine = Extract<SeatCell, { kind: 'mine' }>;
type Props = {
  frames: SeatFrame[]; released: ReadonlySet<string>; head: string | null; locked: boolean; folded: boolean;
  onFold: (v: boolean) => void; onTap: (key: string) => void; wide?: boolean;
  /** The height of his chairs (the wide layout uses 74). */ chairHeight?: number;
};

/** The compact map card (UX §15.10.3, §15.10.9): his rows full size, the others as tiny chairs, the aisle lanes. The hall does not mirror. */
export function SeatMap({ frames, released, head, locked, folded, onFold, onTap, wide, chairHeight = MINE_H }: Props) {
  const { t } = useI18n();
  const k = useTokens();
  const total = frames.reduce((n, f) => n + f.rows.reduce((m, r) => m + r.cells.filter((c) => c.kind === 'mine').length, 0), 0);
  const state = released.size === 0 ? t('seats.form.stateAll') : released.size >= total ? t('seats.form.stateNone') : t('seats.form.stateFree', { n: released.size });
  const isFolded = folded && !wide;

  // Arrow keys move between his chairs by position (web only).
  const onKeyDown = (e: { key: string; preventDefault: () => void; currentTarget: unknown }) => {
    if (Platform.OS !== 'web' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const root = e.currentTarget as HTMLElement;
    const doc = root.ownerDocument;
    const items = [...root.querySelectorAll<HTMLElement>('[data-testid^="seat-chair-"]')];
    const cur = items.findIndex((x) => x === doc.activeElement || x.contains(doc.activeElement));
    if (cur < 0) return;
    const c = items[cur]!.getBoundingClientRect();
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    let best: HTMLElement | null = null; let bestD = Infinity;
    items.forEach((x, i) => {
      if (i === cur) return;
      const r = x.getBoundingClientRect();
      const mx = r.left - c.left, my = r.top - c.top;
      if (dx && (Math.sign(mx) !== dx || Math.abs(my) > 8)) return;
      if (dy && (Math.sign(my) !== dy || Math.abs(my) < 8)) return;
      const d = dx ? Math.abs(mx) : Math.abs(my) * 1000 + Math.abs(mx);
      if (d < bestD) { bestD = d; best = x; }
    });
    if (best) { e.preventDefault(); (best as HTMLElement).focus(); }
  };

  const mineCells = (f: SeatFrame): Array<{ cell: Mine; row: SeatRow }> =>
    f.rows.flatMap((row) => row.cells.flatMap((cell) => (cell.kind === 'mine' ? [{ cell, row }] : [])));
  const chairProps = (f: SeatFrame, row: SeatRow, c: Mine) => {
    const free = released.has(c.key);
    const n = mineCells(f).length;
    const word = t(free ? 'seats.form.wordFree' : 'seats.form.wordKept');
    return {
      free, word,
      a11y: t('seats.form.chair', { block: f.blockName, row: row.label ?? '', k: c.k, n: c.n, aisle: c.key === head ? t('seats.form.nearAisle') : '', state: t(free ? 'seats.form.free' : 'seats.form.kept') }),
      icon: locked ? ('lock' as const) : free ? ('check' as const) : ('user' as const),
      n,
    };
  };

  const header = (f: SeatFrame) => {
    const labels = mineRowLabels(f);
    const n = mineCells(f).length;
    const text = labels.length > 1
      ? t('seats.form.cardRows', { block: f.blockName, from: labels[0] ?? '', to: labels[labels.length - 1] ?? '', n })
      : t('seats.form.cardRow', { block: f.blockName, row: labels[0] ?? '', n });
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
        <Icon name="chair" size={22} color={k.tekhelet} />
        <Txt bold accessibilityRole="header" style={{ flex: 1 }}>{text}</Txt>
      </View>
    );
  };
  const foldButton = wide ? null : (
    <Pressable testID="seat-fold" accessibilityRole="button" accessibilityState={{ expanded: !isFolded }} onPress={() => onFold(!isFolded)}
      style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
      <Txt size="small" bold color={k.tekhelet}>{isFolded ? `${t('seats.form.show')} ⌄` : `${t('seats.form.hide')} ⌃`}</Txt>
    </Pressable>
  );

  return (
    <Card style={{ gap: 6 }}>
      <View style={{ gap: 6 }} {...(Platform.OS === 'web' ? ({ onKeyDown } as object) : null)}>
      {frames.map((f, i) => (
        <View key={f.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>{header(f)}</View>
            {i === 0 ? foldButton : null}
          </View>
          {isFolded ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, direction: 'ltr' }}>
              {mineCells(f).map(({ cell, row }) => {
                const p = chairProps(f, row, cell);
                return (
                  <Pressable key={cell.key} testID={`seat-chair-${cell.key}`} accessibilityRole="switch" accessibilityState={{ checked: !p.free, disabled: locked }}
                    accessibilityLabel={p.a11y} disabled={locked} onPress={() => onTap(cell.key)} style={{ width: 38, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <SeatChair state={p.free ? 'free' : 'kept'} icon={p.icon} size={44} flipKey={String(p.free)} />
                  </Pressable>
                );
              })}
              <Txt size="small" bold color={k.muted} style={{ direction: undefined }}>{state}</Txt>
            </View>
          ) : (
            <FrameBody frame={f} chairProps={(row, c) => chairProps(f, row, c)} onTap={onTap} locked={locked} showArk={i === 0} chairHeight={chairHeight} />
          )}
        </View>
      ))}
      </View>
    </Card>
  );
}

function FrameBody({ frame, chairProps, onTap, locked, showArk, chairHeight }: {
  frame: SeatFrame; chairProps: (row: SeatRow, c: Mine) => { free: boolean; word: string; a11y: string; icon: 'user' | 'check' | 'lock' };
  onTap: (key: string) => void; locked: boolean; showArk: boolean; chairHeight: number;
}) {
  const { t, dir } = useI18n();
  const k = useTokens();
  const [w, setW] = React.useState(0);
  const lanes = frame.lanes;
  const cell = w ? Math.max(14, Math.min(72, (w - LABEL_W - LANE_W * lanes.length - GAP * (frame.cols - 1)) / frame.cols)) : 0;
  const firstMine = frame.rows.findIndex((r) => r.mine);
  const labelRight = dir === 'rtl';
  const dark = useColorScheme() === 'dark';
  const freeCol = dark ? '#8FD49C' : '#256B35';
  const laneSeg = (side: 'left' | 'right', rowIx: number, h: number) => (
    <View key={side} style={{ width: LANE_W, height: h, alignItems: 'center', justifyContent: 'center' }}>
      <DashedLine height={h} color={k.line} />
      {rowIx === firstMine ? (
        <View style={{ width: ROW_H, height: LANE_W, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-90deg' }] }}>
          <Txt size="caption" color={k.muted} style={{ fontSize: 11, backgroundColor: k.surface, paddingHorizontal: 3 }}>{t('seats.form.aisle')}</Txt>
        </View>
      ) : null}
    </View>
  );
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {showArk ? (
        <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 6, gap: 2 }}>
          <View style={{ position: 'absolute', left: 0, right: 0, top: 11, height: 1, backgroundColor: k.line }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: k.stone, borderWidth: 1, borderColor: k.line, borderRadius: 999, paddingHorizontal: 10, height: 22 }}>
            <Icon name="ark" size={14} color={k.muted} />
            <Txt size="caption" bold color={k.muted} style={{ fontSize: 11.5 }}>{t('seats.form.ark')}</Txt>
          </View>
          {frame.gapAbove ? <Txt size="caption" color={k.muted} style={{ lineHeight: 12, letterSpacing: 2 }}>• • •</Txt> : null}
        </View>
      ) : null}
      {w ? frame.rows.map((row, ri) => {
        const mine = row.mine;
        const rowH = chairHeight + 18;
        const h = mine ? rowH : row.bimah ? 20 : OTHER_H + 6;
        const seated = row.cells.some((c) => c.kind === 'mine' || c.kind === 'other');
        const labelCol = (
          <View key="label" style={{ width: LABEL_W, height: h, alignItems: 'center', justifyContent: 'center',  }}>
            {seated ? <Txt size="caption" bold={mine} color={mine ? k.tekhelet : k.muted} style={{ fontSize: mine ? 13 : 11.5, fontVariant: ['tabular-nums'], textAlign: 'center' }}>{row.label ?? ''}</Txt> : null}
          </View>
        );
        const cells: React.ReactNode[] = [];
        let ci = 0;
        while (ci < row.cells.length) {
          const c = row.cells[ci]!;
          if (c.kind === 'bimah') {
            let span = 1;
            while (row.cells[ci + span]?.kind === 'bimah') span++;
            cells.push(
              <View key={ci} style={{ width: cell * span + GAP * (span - 1), height: 16, marginTop: mine ? 0 : 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: k.line, borderRadius: 4, ...(Platform.OS === 'web' ? ({ backgroundImage: HATCH } as object) : null) }}>
                {row.bimah && !frame.rows[ri - 1]?.bimah && ci === row.cells.findIndex((x) => x.kind === 'bimah') ? <Txt size="caption" bold color={k.muted} style={{ fontSize: 11 }}>{t('seats.bimah')}</Txt> : null}
              </View>,
            );
            ci += span;
            continue;
          }
          const style = { width: cell, height: mine ? rowH : OTHER_H + 6, alignItems: 'center' as const, justifyContent: 'flex-start' as const };
          if (c.kind === 'gap') cells.push(<View key={ci} style={{ width: cell, height: mine ? rowH : OTHER_H + 6 }} />);
          else if (c.kind === 'other') {
            cells.push(
              <View key={ci} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ ...style, justifyContent: mine ? 'flex-start' : 'center' }}>
                <SeatChair state="other" icon={null} size={mine ? chairHeight : OTHER_H} />
              </View>,
            );
          } else {
            const p = chairProps(row, c);
            cells.push(
              <Pressable key={ci} testID={`seat-chair-${c.key}`} accessibilityRole="switch" accessibilityState={{ checked: !p.free, disabled: locked }} accessibilityLabel={p.a11y}
                disabled={locked} onPress={() => onTap(c.key)} style={style}>
                <SeatChair state={p.free ? 'free' : 'kept'} icon={p.icon} size={chairHeight} flipKey={String(p.free)} />
                <View style={[{ alignItems: 'center', marginTop: 1, paddingHorizontal: 4, borderWidth: 1.5, borderRadius: 6, borderColor: 'transparent', maxWidth: cell + GAP }, p.free ? { borderStyle: 'dashed', borderColor: freeCol } : null]}>
                  <Txt size="caption" color={p.free ? freeCol : k.danger} style={{ fontSize: 12, fontFamily: fonts.uiBold, fontWeight: '800', textAlign: 'center' }} numberOfLines={1}>{p.word}</Txt>
                </View>
              </Pressable>,
            );
          }
          ci++;
        }
        return (
          <View key={ri} style={{ flexDirection: 'row', direction: 'ltr', alignItems: 'flex-start', height: h }}>
            {labelRight ? null : labelCol}
            {lanes.includes('left') ? laneSeg('left', ri, h) : null}
            <View style={{ flexDirection: 'row', gap: GAP, flex: 1, justifyContent: 'center', direction: 'ltr' }}>{cells}</View>
            {lanes.includes('right') ? laneSeg('right', ri, h) : null}
            {labelRight ? labelCol : null}
          </View>
        );
      }) : null}
    </View>
  );
}

/** A vertical dashed line from short Views, so it is dashed on native too (a one-sided dashed border is not). */
function DashedLine({ height, color }: { height: number; color: string }) {
  const n = Math.floor(height / 6);
  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, width: 1, justifyContent: 'center', gap: 2 }} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => <View key={i} style={{ width: 1, height: 4, backgroundColor: color }} />)}
    </View>
  );
}
