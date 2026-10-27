// The hall as the editor sees it while checking and matching (UX-DESIGN §16.3): shapes only at about 28 px, drawn left to right
// like the room (never mirrored). Hover or focus a cell and its original text is shown by the caller.
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { useTokens, Txt } from '../../../kit/components.tsx';
import { cellKey, resolveTwoNames, twoNameCells } from '../../../seats/decisions.ts';
import type { CellChoice } from '../../../seats/decisions.ts';
import type { ParsedHall } from '../../../seats/paste.ts';
import { rowLabelList } from '../../../seats/savePlan.ts';

const GAP = 3;
const LABEL_W = 48;

export type HoverInfo = { row: number; col: number; text: string };

export function HallMini({ parsed, cells, blockNames, size = 28, lit, flagged, arkLabel, onHover }: {
  parsed: ParsedHall; cells: Record<string, CellChoice>; blockNames: string[]; size?: number;
  /** Seats drawn in the accent colour (the selected household). */ lit?: Set<string>;
  /** Cells with a gold border (to check). */ flagged?: Set<string>;
  arkLabel?: string; onHover?: (h: HoverInfo | null) => void;
}) {
  const k = useTokens();
  const twos = React.useMemo(() => new Map(twoNameCells(parsed).map((c) => [cellKey(c.row, c.col), c])), [parsed]);
  const labels = React.useMemo(() => rowLabelList(parsed), [parsed]);
  const width = parsed.cols * (size + GAP) - GAP;
  const arkW = Math.min(width, Math.max(size * 4, Math.round(parsed.cols / 6) * (size + GAP) - GAP));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled">
      <View style={{ direction: 'ltr', gap: GAP, paddingVertical: 4, paddingHorizontal: 2 }}>
        {arkLabel ? (
          <View style={{ marginStart: LABEL_W, width, alignItems: 'center' }}>
            <View style={{ width: arkW, height: size, borderWidth: 2, borderColor: k.ink, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: k.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Txt serif bold size="caption" numberOfLines={1}>{arkLabel}</Txt>
            </View>
          </View>
        ) : null}
        <View style={{ marginStart: LABEL_W, width, height: 22 }}>
          {parsed.blocks.map((b, i) => (
            <View key={b.index} style={{ position: 'absolute', start: b.colStart * (size + GAP), width: (b.colEnd - b.colStart + 1) * (size + GAP) - GAP, borderBottomWidth: 2, borderBottomColor: k.line, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2, height: 22 }}>
              <Txt size="caption" bold numberOfLines={1} style={{ direction: 'rtl' }}>{blockNames[i] ?? ''}</Txt>
            </View>
          ))}
        </View>
        {parsed.grid.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: GAP, alignItems: 'center' }}>
            <View style={{ width: LABEL_W - GAP, alignItems: 'center' }}><Txt size="caption" color={k.muted} numberOfLines={1}>{labels[r] ?? ''}</Txt></View>
            {row.map((cell, c) => {
              const key = cellKey(r, c);
              const two = twos.get(key);
              const resolved = two ? resolveTwoNames(two, cells[key]) : null;
              const kind = cell.kind === 'unknown' && two && resolved ? (resolved.kind === 'seat' ? 'seat' : 'unassigned') : cell.kind;
              const isLit = lit?.has(key);
              const isFlag = flagged?.has(key) || (!!two && !resolved);
              const text = cell.kind === 'seat' ? cell.raw : cell.kind === 'unknown' ? cell.raw : cell.kind === 'unassigned' ? 'פנוי' : cell.kind === 'bimah' ? 'בימה' : '';
              const base = { width: size, height: size, borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 } as const;
              if (kind === 'empty') return <View key={c} style={{ width: size, height: size, borderWidth: cell.kind === 'empty' ? 0 : 1, borderStyle: 'dotted', borderColor: k.line, borderRadius: 4, ...(isFlag ? { borderWidth: 2, borderColor: k.gold, borderStyle: 'solid' } : null) }} />;
              const style = kind === 'bimah'
                ? { ...base, backgroundColor: k.line, borderWidth: 2, borderColor: k.muted, borderRadius: 6 }
                : kind === 'unassigned'
                  ? { ...base, borderWidth: 1.5, borderStyle: 'dashed' as const, borderColor: k.muted, backgroundColor: 'transparent' }
                  : kind === 'unknown'
                    ? { ...base, borderWidth: 1, borderStyle: 'dotted' as const, borderColor: k.muted }
                    : { ...base, borderWidth: isLit ? 2 : 1, borderColor: isLit ? k.tekhelet : k.muted, backgroundColor: isLit ? k.tekhelet : k.surface };
              return (
                <Pressable key={c} accessibilityLabel={text || undefined} focusable={!!text}
                  onHoverIn={() => onHover?.({ row: r, col: c, text })} onHoverOut={() => onHover?.(null)} onFocus={() => onHover?.({ row: r, col: c, text })} onBlur={() => onHover?.(null)}
                  style={[style, isFlag ? { borderWidth: 2, borderColor: k.gold, borderStyle: 'solid' } : null]} />
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Legend() {
  const k = useTokens();
  const { t } = useI18n();
  const item = (style: object, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={[{ width: 18, height: 14, borderRadius: 4 }, style]} /><Txt size="caption" color={k.muted}>{label}</Txt></View>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {item({ borderWidth: 1, borderColor: k.muted, backgroundColor: k.surface }, t('seatEditor.legend.seat'))}
      {item({ borderWidth: 1.5, borderStyle: 'dashed', borderColor: k.muted }, t('seatEditor.legend.free'))}
      {item({ backgroundColor: k.line, borderWidth: 2, borderColor: k.muted }, t('seatEditor.legend.bimah'))}
      {item({ borderWidth: 2, borderColor: k.gold }, t('seatEditor.legend.check'))}
    </View>
  );
}
