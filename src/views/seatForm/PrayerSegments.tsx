import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import type { Prayer } from '../../seats/release.ts';
import type { SegState } from '../../seats/seatForm.ts';

const PRAYERS: Prayer[] = ['arvit', 'shacharit'];

/** The state words of a prayer ("1 פנוי", "לא מגיעים", "כולם מגיעים", "עוד לא ענית"). */
export function segText(t: (k: string, v?: Record<string, string | number>) => string, s: SegState): string {
  return s.kind === 'unanswered' ? t('seats.form.unanswered') : s.kind === 'all' ? t('seats.form.stateAll') : s.kind === 'none' ? t('seats.form.stateNone') : t('seats.form.stateFree', { n: s.n });
}

/** Two tabs, one per prayer (UX §15.10.2 item 2): the name over the state, with a ring (not answered) or a dot (answered). */
export function PrayerSegments({ value, states, onChange }: { value: Prayer; states: Record<Prayer, SegState>; onChange: (p: Prayer) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 4, gap: 4, borderRadius: 12, backgroundColor: k.stone, borderWidth: 1, borderColor: k.line }}>
      {PRAYERS.map((p) => {
        const sel = p === value;
        const st = states[p];
        const answered = st.kind !== 'unanswered';
        const name = t(p === 'arvit' ? 'seats.form.nameArvit' : 'seats.form.nameShacharit');
        const text = segText(t, st);
        const color = sel ? k.tekhelet : k.muted;
        return (
          <Pressable key={p} testID={`seat-seg-${p}`} accessibilityRole="tab" accessibilityState={{ selected: sel }}
            accessibilityLabel={t('seats.form.segLabel', { prayer: name, state: answered ? `${t('seats.form.answeredWord')}, ${text}` : text })}
            onPress={() => onChange(p)}
            style={{ flex: 1, height: 52, borderRadius: 9, alignItems: 'center', justifyContent: 'center', gap: 1, backgroundColor: sel ? k.surface : 'transparent', borderWidth: 1.5, borderColor: sel ? k.tekhelet : 'transparent' }}>
            <Txt bold color={color} style={{ fontSize: 15, lineHeight: 20, textAlign: 'center' }}>{name}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: color, backgroundColor: answered ? color : 'transparent' }} />
              <Txt color={color} style={{ fontSize: 12, lineHeight: 16 }}>{text}</Txt>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
