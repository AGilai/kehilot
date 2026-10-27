import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../../kit/components.tsx';

export type StepKey = 'paste' | 'check' | 'match' | 'save';
const STEPS: StepKey[] = ['paste', 'check', 'match', 'save'];

/** UX §16.3: four steps, the open one is aria-current. */
export function StepRow({ step }: { step: StepKey }) {
  const { t } = useI18n();
  const k = useTokens();
  const at = STEPS.indexOf(step);
  return (
    <View accessibilityRole="list" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {STEPS.map((s, i) => {
        const on = i === at;
        const done = i < at;
        const color = on ? k.tekhelet : done ? k.olive : k.muted;
        return (
          <React.Fragment key={s}>
            <View accessibilityRole="text" {...(on ? { 'aria-current': 'step' as const } : {})}
              style={{ paddingVertical: 4, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: on ? k.tekhelet : done ? k.olive : k.line, backgroundColor: k.surface }}>
              <Txt size="small" bold color={color}>{`${done ? '✓ ' : ''}${i + 1} · ${t(`seatEditor.step.${s}`)}`}</Txt>
            </View>
            {i < STEPS.length - 1 ? <Txt color={k.muted}>{'‹'}</Txt> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

export function Radio({ on, label, sub, onPress, disabled }: { on: boolean; label: string; sub?: string; onPress: () => void; disabled?: boolean }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 40, paddingVertical: 6 }}>
      <View style={{ width: 20, height: 20, marginTop: 1, borderRadius: 10, borderWidth: 2, borderColor: on ? k.tekhelet : k.muted, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: k.tekhelet }} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt bold={on}>{label}</Txt>
        {sub ? <Txt size="caption" color={k.muted}>{sub}</Txt> : null}
      </View>
    </Pressable>
  );
}

/** The pasted text, as a chip. Text only, never interpreted. */
export function Mono({ text }: { text: string }) {
  const k = useTokens();
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: k.line, backgroundColor: k.stone }}>
      <Txt bold content>{text}</Txt>
    </View>
  );
}
