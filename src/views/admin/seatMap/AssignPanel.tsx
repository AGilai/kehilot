// The side panel of assign mode (UX-DESIGN §16.4): search, chips, household rows with a count bubble (counts only, no seat numbers), the selected
// household's card and the totals. A row is a radio of one list: arrows move, Enter picks.
import React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { textStart } from '../../../i18n/direction.ts';
import { Button, Chip, Txt, useTokens } from '../../../kit/components.tsx';
import { fonts, type } from '../../../kit/theme.ts';
import { filterHouseholds } from '../../../seats/households.ts';
import type { Household, HouseholdFilter } from '../../../seats/households.ts';

export function CountBubble({ n, on }: { n: number; on?: boolean }) {
  const k = useTokens();
  return (
    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: n === 0 ? 'transparent' : on ? k.tekhelet : k.stone, borderWidth: 1, borderStyle: n === 0 ? 'dashed' : 'solid', borderColor: n === 0 ? k.muted : on ? k.tekhelet : k.line }}>
      <Txt size="small" bold color={on && n ? k.onAction : k.ink}>{String(n)}</Txt>
    </View>
  );
}
export const countText = (t: (k: string, p?: Record<string, string | number>) => string, n: number) => (n === 0 ? t('seatMap.panel.countNone') : n === 1 ? t('seatMap.panel.countOne') : t('seatMap.panel.countN', { n }));

export function AssignPanel({ rows, selected, totals, onSelect, onMove, onFreeAll, onNewHolder, searchRef, moving }: {
  rows: Household[]; selected: string | null; totals: { seats: number; assigned: number; free: number };
  onSelect: (ref: string | null) => void; onMove: () => void; onFreeAll: () => void; onNewHolder: () => void; searchRef: React.RefObject<TextInput | null>; moving: boolean;
}) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const [query, setQuery] = React.useState('');
  const [chip, setChip] = React.useState<HouseholdFilter>('all');
  const shown = React.useMemo(() => filterHouseholds(rows, query, chip), [rows, query, chip]);
  const cur = rows.find((r) => r.ref === selected) ?? null;
  return (
    <View style={{ width: 360, borderStartWidth: 1, borderStartColor: k.line, backgroundColor: k.surface }}>
      <View style={{ padding: 12, gap: 8 }}>
        <TextInput ref={searchRef} accessibilityLabel={t('seatMap.panel.search')} placeholder={t('seatMap.panel.search')} placeholderTextColor={k.muted} value={query} onChangeText={setQuery}
          style={{ minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) }} />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'none', 'noAccount'] as const).map((c) => <Chip key={c} size="filter" label={t(`seatMap.panel.${c}`)} selected={chip === c} onPress={() => setChip(c)} />)}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4 }} keyboardShouldPersistTaps="handled">
        {shown.length === 0 ? <Txt size="small" color={k.muted}>{t('seatMap.panel.empty')}</Txt> : null}
        <View accessibilityRole="radiogroup" style={{ gap: 4 }}>
          {shown.map((r) => {
            const on = r.ref === selected;
            return (
              <Pressable key={r.ref} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${r.full}, ${countText(t, r.count)}`} disabled={moving} onPress={() => onSelect(on ? null : r.ref)}
                style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: on ? 2 : 1, borderColor: on ? k.tekhelet : k.line, backgroundColor: on ? k.stone : k.surface }}>
                <CountBubble n={r.count} on={on} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt bold={on} numberOfLines={1} content>{r.full}</Txt>
                  {r.blocks.length ? <Txt size="caption" color={k.muted} numberOfLines={1} content>{r.blocks.join(' · ')}</Txt> : null}
                </View>
                {r.pending ? <Tag text={t('seatMap.panel.new')} /> : null}
                {r.noAccount ? <Tag text={t('seatMap.panel.noAccount')} dashed /> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: k.line }}>
        {cur ? (
          <View style={{ gap: 6 }}>
            <Txt bold content>{cur.full}</Txt>
            <Txt size="small" color={k.muted}>{`${cur.noAccount ? t('seatMap.panel.holder') : t('seatMap.panel.registered')} · ${countText(t, cur.count)}`}</Txt>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button kind="secondary" title={t('seatMap.panel.move')} disabled={cur.count === 0 || moving} onPress={onMove} /></View>
              <View style={{ flex: 1 }}><Button kind="secondary" title={t('seatMap.panel.freeAll')} disabled={cur.count === 0 || moving} onPress={onFreeAll} /></View>
            </View>
          </View>
        ) : <Txt size="small" color={k.muted}>{t('seatMap.panel.pick')}</Txt>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt size="small" color={k.muted} accessibilityLiveRegion="polite" style={{ flex: 1 }}>{t('seatMap.panel.totals', totals)}</Txt>
          <Button kind="secondary" title={t('seatMap.panel.newHolder')} onPress={onNewHolder} />
        </View>
      </View>
    </View>
  );
}

function Tag({ text, dashed }: { text: string; dashed?: boolean }) {
  const k = useTokens();
  return <View style={{ borderWidth: 1, borderStyle: dashed ? 'dashed' : 'solid', borderColor: k.gold, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}><Txt size="caption" color={k.gold}>{text}</Txt></View>;
}
