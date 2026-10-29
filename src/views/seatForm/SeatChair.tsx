import React from 'react';
import { AccessibilityInfo, Animated, Easing, useColorScheme } from 'react-native';
import { Image } from 'expo-image';
import { useTokens } from '../../kit/components.tsx';
import { chairSvg } from '../../seats/chairSvg.ts';
import type { ChairIcon, ChairState } from '../../seats/chairSvg.ts';

const RATIO = 50 / 62;
const FLIP_MS = 150;

/**
 * The synagogue-chair glyph (UX §15.10.3), an SVG drawn by expo-image. `size` is its height. When `flipKey` changes it turns
 * (scaleX 1 → 0 → 1, 150 ms) and the new picture is swapped in at the narrowest point; with reduce-motion it just changes.
 */
export function SeatChair({ state, icon, size, flipKey }: { state: ChairState; icon: ChairIcon | null; size: number; flipKey?: string }) {
  const k = useTokens();
  const dark = useColorScheme() === 'dark';
  const want = React.useMemo(() => ({ state, icon }), [state, icon]);
  const [shown, setShown] = React.useState(want);
  const scale = React.useRef(new Animated.Value(1)).current;
  const first = React.useRef(true);
  const latest = React.useRef(want);
  latest.current = want;

  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (!alive) return;
      if (reduce) { setShown(latest.current); return; }
      Animated.timing(scale, { toValue: 0, duration: FLIP_MS / 2, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        if (!alive) return;
        setShown(latest.current);
        Animated.timing(scale, { toValue: 1, duration: FLIP_MS / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      });
    });
    return () => { alive = false; };
  }, [flipKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Without a flipKey the picture follows the props at once.
  React.useEffect(() => { if (flipKey === undefined) setShown(want); }, [flipKey, want]);

  const uri = React.useMemo(
    () => 'data:image/svg+xml;utf8,' + encodeURIComponent(chairSvg({ state: shown.state, icon: shown.icon, dark, grey: { fill: k.line, seam: k.surface } })),
    [shown, dark, k.line, k.surface],
  );
  return (
    <Animated.View style={{ width: size * RATIO, height: size, transform: [{ scaleX: scale }] }}>
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" accessible={false} importantForAccessibility="no" accessibilityElementsHidden />
    </Animated.View>
  );
}
