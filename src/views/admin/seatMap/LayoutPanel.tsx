// The side panel of layout mode (UX-DESIGN §16.4): the cell palette, rows and columns within the caps, block names, the focused row's name.
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Txt, useTokens } from '../../../kit/components.tsx';
import { BLOCK_NAME_MAX, ROW_LABEL_MAX } from '../../../seats/editModel.ts';
import type { Draft, EditError, Kind } from '../../../seats/editModel.ts';

export const PALETTE: { kind: Kind; key: string }[] = [{ kind: 'seat', key: 'S' }, { kind: 'aisle', key: 'A' }, { kind: 'bimah', key: 'B' }, { kind: 'ark', key: 'K' }, { kind: 'empty', key: 'Del' }];

export function LayoutPanel({ draft, selected, focusRow, error, onPaint, onAddRow, onAddCol, onRemoveRow, onRemoveCol, onBlockName, onRowLabel }: {
  draft: Draft; selected: number; focusRow: number | null; error: EditError | null;
  onPaint: (kind: Kind) => void; onAddRow: (w: 'front' | 'back') => void; onAddCol: (w: 'left' | 'right') => void; onRemoveRow: () => void; onRemoveCol: () => void;
  onBlockName: (i: number, name: string) => void; onRowLabel: (row: number, label: string) => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const L = draft.layout;
  const err = error === 'rows-cap' ? t('seatMap.layout.rowsCap', { n: 40 }) : error === 'cols-cap' ? t('seatMap.layout.colsCap', { n: 60 }) : error === 'last-row' || error === 'last-col' ? t('seatMap.layout.last') : null;
  return (
    <View style={{ width: 360, borderStartWidth: 1, borderStartColor: k.line, backgroundColor: k.surface }}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Txt size="small" color={k.muted}>{t('seatMap.layout.hint')}</Txt>
        <View style={{ gap: 6 }}>
          <Txt bold>{t('seatMap.layout.palette')}</Txt>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {PALETTE.map((p) => (
              <Pressable key={p.kind} accessibilityRole="button" accessibilityLabel={`${t(`seatMap.layout.kind.${p.kind}`)} (${p.key})`} disabled={selected === 0} onPress={() => onPaint(p.kind)}
                style={{ minHeight: 44, minWidth: 64, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: k.tekhelet, alignItems: 'center', justifyContent: 'center', opacity: selected === 0 ? 0.45 : 1, backgroundColor: k.surface }}>
                <Txt size="small" bold color={k.tekhelet}>{t(`seatMap.layout.kind.${p.kind}`)}</Txt>
                <Txt size="caption" color={k.muted}>{p.key}</Txt>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <Txt size="small" color={k.muted}>{t('seatMap.layout.size', { rows: L.rows, cols: L.cols })}</Txt>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Button kind="secondary" title={t('seatMap.layout.addRowFront')} onPress={() => onAddRow('front')} />
            <Button kind="secondary" title={t('seatMap.layout.addRowBack')} onPress={() => onAddRow('back')} />
            <Button kind="secondary" title={t('seatMap.layout.addColLeft')} onPress={() => onAddCol('left')} />
            <Button kind="secondary" title={t('seatMap.layout.addColRight')} onPress={() => onAddCol('right')} />
            <Button kind="secondary" title={t('seatMap.layout.removeRow')} disabled={focusRow === null} onPress={onRemoveRow} />
            <Button kind="secondary" title={t('seatMap.layout.removeCol')} disabled={focusRow === null} onPress={onRemoveCol} />
          </View>
          {focusRow === null ? <Txt size="caption" color={k.muted}>{t('seatMap.layout.pickCell')}</Txt> : null}
          {err ? <Banner tone="error" text={err} /> : null}
        </View>
        {focusRow !== null ? (
          <Field label={`${t('seatMap.layout.rowLabel')} · ${t('seatMap.layout.rowLabelFor', { n: focusRow + 1 })}`} value={L.rowLabels[focusRow] ?? ''} maxCodePoints={ROW_LABEL_MAX} onChangeText={(v) => onRowLabel(focusRow, v)} />
        ) : null}
        <View style={{ gap: 8 }}>
          <Txt bold>{t('seatMap.layout.blocks')}</Txt>
          {L.blocks.map((b, i) => <Field key={i} label={`${t('seatMap.layout.blockName')} ${i + 1}`} value={b.name} maxCodePoints={BLOCK_NAME_MAX} onChangeText={(v) => onBlockName(i, v)} error={b.name.trim() ? null : t('seatMap.save.blockName')} />)}
        </View>
      </ScrollView>
    </View>
  );
}
