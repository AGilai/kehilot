import React from 'react';
import { AccessibilityInfo, Animated, Easing, useColorScheme } from 'react-native';
import { Image } from 'expo-image';
import { useTokens } from '../../kit/components.tsx';
import { chairSvg } from '../../seats/chairSvg.ts';
import type { ChairIcon, ChairState } from '../../seats/chairSvg.ts';

const RATIO = 50 / 62;
const FLIP_MS = 150;

const URIS = new Map<string, string>();
/** One data URI per picture: the same chair is drawn dozens of times. */
function chairUri(state: ChairState, icon: ChairIcon | null, dark: boolean, grey: { fill: string; seam: string }): string {
  const key = `${state}|${icon ?? ''}|${dark ? 'd' : 'l'}|${grey.fill}|${grey.seam}`;
  let uri = URIS.get(key);
  if (!uri) { uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(chairSvg({ state, icon, dark, grey })); URIS.set(key, uri); }
  return uri;
}
const cacheKeyOf = (state: ChairState, icon: ChairIcon | null, dark: boolean, grey: { fill: string }): string => `chair-${state}-${icon ?? 'x'}-${dark ? 'd' : 'l'}-${grey.fill}`;

/**
 * The synagogue-chair glyph (UX §15.10.3), an SVG drawn by expo-image. `size` is its height. When `flipKey` changes it turns
 * (scaleX 1 → 0 → 1, 150 ms) and the new picture is swapped in at the narrowest point; with reduce-motion it just changes.
 */
export function SeatChair({ state, icon, size, flipKey }: { state: ChairState; icon: ChairIcon | null; size: number; flipKey?: string }) {
  if (state === 'other') return <OtherChair size={size} />;
  return <FlipChair state={state} icon={icon} size={size} flipKey={flipKey} />;
}

/** The grey chair of other families: a plain image, never flipped. */
function OtherChair({ size }: { size: number }) {
  const k = useTokens();
  const dark = useColorScheme() === 'dark';
  const grey = { fill: k.line, seam: k.surface };
  return <Image source={{ uri: chairUri('other', null, dark, grey), cacheKey: cacheKeyOf('other', null, dark, grey) }} style={{ width: size * RATIO, height: size }} contentFit="contain" transition={0} accessible={false} importantForAccessibility="no" accessibilityElementsHidden />;
}

function FlipChair({ state, icon, size, flipKey }: { state: ChairState; icon: ChairIcon | null; size: number; flipKey?: string }) {
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

  const grey = { fill: k.line, seam: k.surface };
  const source = { uri: chairUri(shown.state, shown.icon, dark, grey), cacheKey: cacheKeyOf(shown.state, shown.icon, dark, grey) };
  return (
    <Animated.View style={{ width: size * RATIO, height: size, transform: [{ scaleX: scale }] }}>
      <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={0} accessible={false} importantForAccessibility="no" accessibilityElementsHidden />
    </Animated.View>
  );
}
