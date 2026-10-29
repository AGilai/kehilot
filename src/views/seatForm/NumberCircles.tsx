import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { fonts } from '../../kit/theme.ts';
import { CHAIR_COLORS } from '../../seats/chairSvg.ts';
import { circleLayout } from '../../seats/seatForm.ts';

/** The circles 0..n (UX §15.10.4): a radiogroup, 0 at the start. N is drawn as "all free" (green). */
export function NumberCircles({ n, value, locked, onPick }: { n: number; value: number | null; locked: boolean; onPick: (k: number) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const [w, setW] = React.useState(358);
  const dark = k.stone !== '#F6F7F2';
  const green = CHAIR_COLORS[dark ? 'dark' : 'light'];
  const { size, gap, wrap } = circleLayout(n, w);
  const ks = Array.from({ length: n + 1 }, (_, i) => i);

  const onKeyDown = (e: { key: string; preventDefault: () => void; currentTarget: unknown }) => {
    if (Platform.OS !== 'web' || locked) return;
    const root = e.currentTarget as HTMLElement;
    const items = [...root.querySelectorAll<HTMLElement>('[data-testid^="seat-circle-"]')];
    const cur = items.findIndex((x) => x === root.ownerDocument.activeElement);
    if (cur < 0) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); items[cur]!.click(); return; }
    // Arrows follow what is on screen: the DOM order is 0..n, and the row runs right to left in Hebrew.
    const rtl = root.ownerDocument.dir === 'rtl' || getComputedStyle(root).direction === 'rtl';
    const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const next = items[cur + step];
    if (step && next) { e.preventDefault(); next.focus(); }
  };

  return (
    <View style={{ gap: 6 }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="radiogroup" {...(Platform.OS === 'web' ? ({ onKeyDown } as object) : null)}
        style={{ flexDirection: 'row', flexWrap: wrap ? 'wrap' : 'nowrap', gap: wrap ? 8 : 0, columnGap: gap, justifyContent: 'flex-start', opacity: locked ? 0.6 : 1 }}>
        {ks.map((i) => {
          const sel = value === i;
          const isAll = i === n && n > 0;
          const label = i === 0 ? t('seats.form.circle0') : isAll ? t('seats.form.circleN', { n }) : t('seats.form.circleK', { k: i });
          const ring = isAll ? green.freeLine : sel ? k.tekhelet : k.line;
          const bg = sel ? (isAll ? green.free : k.tekhelet) : k.surface;
          const fg = isAll ? (sel ? green.freeIcon : green.freeLine) : sel ? k.onAction : k.ink;
          return (
            <Pressable key={i} testID={`seat-circle-${i}`} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: sel, disabled: locked }}
              disabled={locked} onPress={() => onPick(i)} hitSlop={{ top: 4, bottom: 4 }}
              style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg,
                borderWidth: isAll ? 2 : 1.5, borderStyle: isAll && !sel ? 'dashed' : 'solid', borderColor: ring,
                ...(sel && !isAll ? { shadowColor: k.tekhelet, shadowOpacity: 0.25, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 0 3px ${k.tekhelet}40` } as object) : null) } : null) }}>
              <Txt color={fg} style={{ fontSize: 19, lineHeight: 24, fontFamily: fonts.uiBold, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{String(i)}</Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Txt size="caption" color={k.muted} style={{ flexShrink: 1 }}>{t('seats.form.count0')}</Txt>
        <Txt size="caption" color={k.muted} style={{ flexShrink: 1, textAlign: 'right' }}>{t('seats.form.countAll', { n })}</Txt>
      </View>
    </View>
  );
}
