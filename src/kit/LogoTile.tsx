import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Txt, useTokens } from './components.tsx';

/**
 * The Kehila logo: the image on a white rounded tile (also in dark mode, so a dark mark stays readable), or the
 * tekhelet letter tile when there is no image. `label` is the accessibility label of the image ("לוגו {kehila}").
 */
export function LogoTile({ uri, letter, size, label }: { uri: string | null | undefined; letter: string; size: number; label: string }) {
  const k = useTokens();
  const radius = size / 4;
  if (uri) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: k.line, overflow: 'hidden' }}>
        <Image accessibilityLabel={label} source={{ uri }} contentFit="contain" style={{ position: 'absolute', top: 2, left: 2, right: 2, bottom: 2 }} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: k.tekhelet, alignItems: 'center', justifyContent: 'center' }}>
      <Txt bold color={k.onAction} style={{ textAlign: 'center', lineHeight: size }}>{letter}</Txt>
    </View>
  );
}
