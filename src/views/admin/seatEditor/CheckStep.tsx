// Step 2 (UX-DESIGN §16.3, P28 frame 2): how the paste was read. Hall at "fit", totals, warnings with their place, block names, what was not read.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { textStart } from '../../../i18n/direction.ts';
import { Banner, Button, Card, Txt, useTokens } from '../../../kit/components.tsx';
import { cellKey } from '../../../seats/decisions.ts';
import type { CellChoice } from '../../../seats/decisions.ts';
import type { ParseWarning, ParsedHall } from '../../../seats/paste.ts';
import { BLOCK_NAME_MAX, blockIssues, rowText } from '../../../seats/savePlan.ts';
import { HallMini, Legend } from './HallMini.tsx';
import type { HoverInfo } from './HallMini.tsx';

export function blockOfCol(parsed: ParsedHall, col: number): number {
  return parsed.blocks.findIndex((b) => col >= b.colStart && col <= b.colEnd);
}

export function CheckStep({ parsed, cells, blockNames, onBlockName, families, onRepaste, onNext }: {
  parsed: ParsedHall; cells: Record<string, CellChoice>; blockNames: string[]; onBlockName: (index: number, value: string) => void;
  /** Households the matching step will list. */ families: number; onRepaste: () => void; onNext: () => void;
}) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const [hover, setHover] = React.useState<HoverInfo | null>(null);
  const [shown, setShown] = React.useState<string | null>(null);
  const [showIgnored, setShowIgnored] = React.useState(false);
  const issues = blockIssues(blockNames);
  const where = (w: ParseWarning) => {
    if (w.col < 0) return t('seatEditor.where.labels', { row: rowText(parsed, w.row) });
    const b = blockOfCol(parsed, w.col);
    return t('seatEditor.where.cell', { row: rowText(parsed, w.row), block: b >= 0 ? blockNames[b] || t('seatEditor.block', { n: b + 1 }) : '' });
  };
  const warnText = (w: ParseWarning) => {
    const family = w.familyKey ?? '';
    return t(`seatEditor.warn.${w.code}`, { raw: w.raw ?? '', family });
  };
  const checkable = parsed.warnings.filter((w) => w.code !== 'ignored-cell' && w.code !== 'label-ignored' && w.code !== 'spans-blocks');
  const spans = parsed.warnings.filter((w) => w.code === 'spans-blocks');
  const ignored = parsed.warnings.filter((w) => w.code === 'ignored-cell' || w.code === 'label-ignored');
  const flagged = React.useMemo(() => new Set(checkable.filter((w) => w.col >= 0).map((w) => cellKey(w.row, w.col))), [parsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const lit = React.useMemo(() => new Set(shown ? [shown] : []), [shown]);
  const c = parsed.counts;
  const stat = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt color={k.muted}>{label}</Txt><Txt bold>{value}</Txt></View>
  );
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Txt size="small" color={k.muted}>{t('seatEditor.check.lead')}</Txt>
        <Legend />
        <HallMini parsed={parsed} cells={cells} blockNames={blockNames.map((n, i) => n || t('seatEditor.block', { n: i + 1 }))} arkLabel={t('seatEditor.ark')} flagged={shown ? undefined : flagged} lit={lit} onHover={setHover} />
        <View accessibilityLiveRegion="polite" style={{ minHeight: 48, gap: 2 }}>
          <Txt size="small" color={k.muted}>{t('seatEditor.check.hover')}</Txt>
          {hover?.text ? <Txt bold content>{hover.text}</Txt> : null}
        </View>
      </ScrollView>
      <ScrollView style={{ width: 420, flexGrow: 0, flexShrink: 0, backgroundColor: k.surface, borderStartWidth: 1, borderStartColor: k.line }} contentContainerStyle={{ padding: 18, gap: 14 }}>
        <Card>
          <Txt serif size="heading" accessibilityRole="header">{t('seatEditor.check.found')}</Txt>
          {stat(t('seatEditor.check.seats'), String(c.seats))}
          {stat(t('seatEditor.check.households'), String(c.families))}
          {stat(t('seatEditor.check.free'), String(c.unassigned))}
          {stat(t('seatEditor.check.blocks'), String(c.blocks))}
          {stat(t('seatEditor.check.rows'), String(c.rows))}
          {parsed.bimahAreas.length ? stat(t('seatEditor.check.bimah'), parsed.bimahAreas.map((a) => (a.sized ? `${a.rows}×${a.cols}` : '1')).join(' · ')) : null}
        </Card>
        {checkable.length ? (
          <View style={{ gap: 8 }}>
            <View accessibilityRole="alert" style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: k.gold, borderStartWidth: 6, backgroundColor: k.surface }}><Txt bold color={k.gold}>{t('seatEditor.check.toCheck', { n: checkable.length })}</Txt></View>
            {checkable.map((w, i) => (
              <View key={i} style={{ gap: 4, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: k.gold, borderStartWidth: 5, backgroundColor: k.surface }}>
                <Txt size="small" bold color={k.gold}>{where(w)}</Txt>
                <Txt size="small" content>{warnText(w)}</Txt>
                {w.col >= 0 ? <Button kind="secondary" title={t('seatEditor.show')} onPress={() => setShown(cellKey(w.row, w.col))} /> : null}
              </View>
            ))}
          </View>
        ) : null}
        <Banner text={t('seatEditor.check.arkNote')} />
        {spans.length ? <Txt size="small" color={k.muted}>{t('seatEditor.check.spans', { n: new Set(spans.map((w) => w.familyKey)).size })}</Txt> : null}
        <Card>
          <Txt serif size="heading" accessibilityRole="header">{t('seatEditor.check.blockNames')}</Txt>
          <Txt size="small" color={k.muted}>{t('seatEditor.check.blockHelp')}</Txt>
          {[...parsed.blocks].reverse().map((b) => {
            const bad = issues.find((x) => x.index === b.index);
            return (
              <View key={b.index} style={{ gap: 4 }}>
                <Txt size="small" bold>{t('seatEditor.check.blockRow', { n: parsed.blocks.length - b.index, cols: b.colEnd - b.colStart + 1, seats: b.seats })}</Txt>
                <TextInput accessibilityLabel={t('seatEditor.check.blockLabel', { n: parsed.blocks.length - b.index })} placeholder={t('seatEditor.check.blockPlaceholder')} placeholderTextColor={k.muted}
                  value={blockNames[b.index] ?? ''} onChangeText={(v) => onBlockName(b.index, v)} maxLength={BLOCK_NAME_MAX + 8}
                  style={{ minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: bad ? k.danger : k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: 16, writingDirection: dir, textAlign: textStart(lang) }} />
                {bad ? <Txt size="small" color={k.danger}>{t(`seatEditor.check.blockIssue.${bad.code}`, { max: BLOCK_NAME_MAX })}</Txt> : null}
              </View>
            );
          })}
          {issues.some((x) => x.code === 'too-many') ? <Banner tone="error" text={t('seatEditor.check.blockIssue.too-many', { max: 12 })} /> : null}
        </Card>
        {ignored.length ? (
          <View style={{ gap: 6 }}>
            <Button kind="secondary" title={t('seatEditor.check.ignored', { n: ignored.length })} onPress={() => setShowIgnored((v) => !v)} />
            {showIgnored ? ignored.map((w, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Txt size="small" color={k.muted}>{where(w)}</Txt>
                <Txt size="small" content>{w.raw ?? ''}</Txt>
              </View>
            )) : null}
          </View>
        ) : null}
        <View style={{ gap: 8 }}>
          <Button title={t('seatEditor.check.next', { n: families })} disabled={issues.length > 0} onPress={onNext} />
          <Button kind="secondary" title={t('seatEditor.repaste')} onPress={onRepaste} />
        </View>
      </ScrollView>
    </View>
  );
}
