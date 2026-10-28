// One line of the weekly sheet on the management screen (UX-DESIGN §19.3, P44): a 56-high row with the line, its source Tag and a 44 "more"
// button, and the pending row with its two 40-high buttons. A line the sheet leaves off ("לא נכנס") has a dashed gold edge, hatching and the word.
import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { relativeWhen, lineOf, sourceTag } from '../../../client/sheetItems.ts';
import type { Row } from '../../../client/sheetItems.ts';
import type { SheetItem } from '../../../client/types.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../../kit/components.tsx';
import { Icon } from '../../../kit/Icon.tsx';
import type { IconName } from '../../../kit/Icon.tsx';

export const typeIcon = (item: SheetItem): IconName => (item.type === 'celebration' ? 'heart' : item.type === 'condolence' ? 'flame' : item.type === 'event' ? 'cal' : 'pin');

/** The line with its bold surname; the Gregorian part of a date in it stays left to right. Never a plain string, so the bold survives. */
export function LineText({ item, size = 'body' }: { item: SheetItem; size?: 'body' | 'small' }) {
  const k = useTokens();
  const line = lineOf(item);
  return (
    <View style={{ gap: 2, flexShrink: 1 }}>
      <Txt size={size} content>
        {line.main.map((p, i) => <Txt key={i} size={size} bold={p.bold} color={p.bold ? (item.type === 'event' ? k.tekhelet : k.pomegranate) : k.ink} content>{Platform.OS === 'web' ? p.text.replace(/\s+/g, ' ') : p.text}</Txt>)}
      </Txt>
      {line.sub ? <Txt size="small" color={k.muted} content>{line.sub}</Txt> : null}
    </View>
  );
}

/** Small coloured chip: colour is never the only signal, the label is always there. */
export function ToneTag({ label, tone, dashed }: { label: string; tone: 'olive' | 'tekhelet' | 'gold' | 'plain' | 'pomegranate'; dashed?: boolean }) {
  const k = useTokens();
  const color = { olive: k.olive, tekhelet: k.tekhelet, gold: k.gold, pomegranate: k.pomegranate, plain: k.muted }[tone];
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, minHeight: 24, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderStyle: dashed ? 'dashed' : 'solid', borderColor: color, backgroundColor: k.surface }}>
      <Txt size="caption" bold color={color}>{label}</Txt>
    </View>
  );
}

const HATCH = { backgroundImage: 'repeating-linear-gradient(135deg, rgba(143,101,18,0.10) 0 6px, transparent 6px 12px)' } as object;

/** An item in state `in`: the line, the source Tag (the "doesn't fit" Tag when it is left off) and the `more` button. */
export function SheetItemRow({ row, onMore, last }: { row: Row; onMore: () => void; last?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const tag = sourceTag(row.item, t);
  const who = row.item.source === 'approved' ? '' : row.item.postedBy || '';
  const label = t('sheetItems.rowLabel', { line: [lineOf(row.item).main.map(p => p.text).join(''), lineOf(row.item).sub].filter(Boolean).join(' '), source: row.out ? t('sheetItems.src.out') : tag.label, i: row.index, n: row.count });
  return (
    <View accessible accessibilityLabel={label} style={[{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingStart: 12, paddingEnd: 2, paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: k.line }, row.out ? { borderWidth: 1, borderStyle: 'dashed', borderColor: k.gold, borderRadius: 10, marginVertical: 2, ...(Platform.OS === 'web' ? HATCH : { backgroundColor: k.stone }) } : null]}>
      <Icon name={typeIcon(row.item)} size={22} color={row.item.type === 'celebration' ? k.pomegranate : k.tekhelet} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <LineText item={row.item} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {row.out ? <ToneTag label={t('sheetItems.src.out')} tone="gold" dashed /> : null}
          <ToneTag label={tag.label} tone={tag.tone} />
          {who ? <Txt size="caption" color={k.muted} content>{who}</Txt> : null}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('sheetItems.rowMore')}: ${label}`} onPress={onMore} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="more" size={24} color={k.ink} />
      </Pressable>
    </View>
  );
}

/** A 40-high button (primary or secondary) for the pending row. */
function Small({ title, label, primary, onPress, disabled }: { title: string; label?: string; primary?: boolean; onPress: () => void; disabled?: boolean }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={{ opacity: disabled ? 0.5 : 1, flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: primary ? k.tekhelet : k.surface, borderWidth: 1, borderColor: primary ? k.tekhelet : k.line }}>
      <Txt size="small" bold color={primary ? k.surface : k.ink}>{title}</Txt>
    </Pressable>
  );
}

/** A line waiting for approval: icon, line, "ממתין" Tag, who posted it and when, and the two buttons. */
export function PendingRow({ item, onAdd, onSkip, last, disabled }: { item: SheetItem; onAdd: () => void; onSkip: () => void; last?: boolean; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const plain = lineOf(item).main.map(p => p.text).join('');
  const when = relativeWhen(item.postedAt, Date.now(), lang);
  return (
    <View style={{ gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: k.line }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Icon name={typeIcon(item)} size={22} color={item.type === 'celebration' ? k.pomegranate : k.tekhelet} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <LineText item={item} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <ToneTag label={t('sheetItems.tagPending')} tone="pomegranate" />
            <Txt size="caption" color={k.muted} content>{[item.postedBy ? t('sheetItems.src.postedBy', { name: item.postedBy }) : '', when].filter(Boolean).join(' · ')}</Txt>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Small primary title={t('sheetItems.add')} label={t('sheetItems.addLabel', { line: plain })} onPress={onAdd} disabled={disabled} />
        <Small title={t('sheetItems.skip')} label={t('sheetItems.skipLabel', { line: plain })} onPress={onSkip} disabled={disabled} />
      </View>
    </View>
  );
}

