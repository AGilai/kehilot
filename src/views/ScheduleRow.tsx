import React from 'react';
import { View } from 'react-native';
import { clockLabel, textIn } from '../schedule/memberView.ts';
import type { ComputedRow } from '../schedule/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../kit/components.tsx';

/** "This week only" marker (UX §14.1): gold dashed outline with words, never colour alone. */
export function WeekTag({ label }: { label: string }) {
  const k = useTokens();
  return (
    <View style={{ paddingHorizontal: 8, minHeight: 24, justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: k.gold, backgroundColor: k.surface }}>
      <Txt size="caption" bold color={k.gold}>{label}</Txt>
    </View>
  );
}

const time: { fontVariant: ['tabular-nums'] } = { fontVariant: ['tabular-nums'] };

/** One member-facing schedule row (UX §14.7): name, note, time, override, next and past states. `compact` = Home's 40 px line. */
export function ScheduleRow({ row, first, compact, next, nextCaption, past, suffix }: {
  row: ComputedRow; first?: boolean; compact?: boolean; next?: boolean; nextCaption?: string; past?: boolean; suffix?: string;
}) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const name = textIn(row.label, lang);
  const line = { borderTopWidth: first ? 0 : 1, borderTopColor: k.line };
  if (row.source === 'text' || row.time === null) {
    return (
      <View style={[{ paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, line]}>
        <Txt size="small" color={k.muted} style={{ flexShrink: 1 }}>{name}</Txt>
        {row.added ? <WeekTag label={t('schedule.addedThisWeek')} /> : null}
      </View>
    );
  }
  const changed = row.source === 'override' && !row.added;
  const note = changed ? row.overrideNote : row.note;
  const ink = past ? k.muted : k.ink;
  if (compact) {
    return (
      <View style={[{ minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, line]}>
        <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Txt color={ink}>{name}{suffix ? ` · ${suffix}` : ''}</Txt>
          {changed || row.added ? <WeekTag label={row.added ? t('schedule.addedThisWeek') : t('schedule.thisWeek')} /> : null}
        </View>
        <Txt bold color={ink} style={time}>{clockLabel(row.time)}</Txt>
      </View>
    );
  }
  return (
    <View style={[{ minHeight: 44, paddingVertical: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, line,
      next ? { marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10, borderWidth: 2, borderColor: k.tekhelet, borderTopWidth: 2, backgroundColor: k.surface } : null]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Txt color={ink} style={{ flexShrink: 1 }}>{name}</Txt>
          {changed || row.added ? <WeekTag label={row.added ? t('schedule.addedThisWeek') : t('schedule.thisWeek')} /> : null}
        </View>
        {note ? <Txt size="caption" color={k.muted}>{note}</Txt> : null}
        {next && nextCaption ? <Txt size="caption" color={k.muted}>{nextCaption}</Txt> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }} accessible={changed && !!row.usual} accessibilityLabel={changed && row.usual ? `${clockLabel(row.time)}. ${t('schedule.usually', { time: clockLabel(row.usual) })}` : undefined}>
        <Txt bold color={next ? k.tekhelet : ink} style={[time, { minWidth: 48 }]}>{clockLabel(row.time)}</Txt>
        {changed && row.usual ? <Txt size="caption" color={k.muted} style={[time, { textDecorationLine: 'line-through' }]}>{clockLabel(row.usual)}</Txt> : null}
      </View>
    </View>
  );
}
