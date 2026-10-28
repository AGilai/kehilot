import React from 'react';
import { useColorScheme, View } from 'react-native';
import { Image } from 'expo-image';
import { aspectOf, coupleSvg, figureSvg, ghostSvg, resolveFigure, stageOf } from './figures/figure.ts';
import type { Person } from './types.ts';

const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
const seedOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };
const member = (p: Person) => { const stage = stageOf(p.birth, p.relation, today(), p.gender); return { stage, gender: p.gender, options: resolveFigure(p.relation, p.gender, stage, p.figure), seed: seedOf(p.id) }; };

/** A family-tree figure drawn as SVG through expo-image (like kit/Icon.tsx). `style` B (head and shoulders in a disc) for
 *  tiles, A (whole body) for the sheet header. With `partner`, a married child: one tile, `person` in front. No person: the empty slot.
 *  `size` is the height (A) or the side (B). The "ז״ל" label and the name are drawn by the caller, outside the image. */
export function Figure({ person, partner, size = 64, style = 'B' }: { person?: Person; partner?: Person; size?: number; style?: 'A' | 'B' }) {
  const dark = useColorScheme() === 'dark';
  const svg = React.useMemo(() => {
    if (!person) return ghostSvg(style, dark);
    if (partner) return coupleSvg({ style, dark, child: { ...member(person), deceased: !!person.deceased, ill: !!person.ill }, spouse: { ...member(partner), deceased: !!partner.deceased, ill: !!partner.ill } });
    return figureSvg({ style, dark, deceased: !!person.deceased, ill: !!person.ill, ...member(person) });
  }, [person, partner, style, dark]);
  const uri = React.useMemo(() => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), [svg]);
  const width = Math.round(size * aspectOf(svg));
  const image = <Image source={{ uri }} style={{ width, height: size }} contentFit="contain" accessible={false} importantForAccessibility="no" accessibilityElementsHidden />;
  // B is a disc: the image is square art on a round disc, so a wrapper rounds it (the SVG itself has no clipPath).
  return style === 'B' && person ? <View style={{ width, height: size, borderRadius: size / 2, overflow: 'hidden' }}>{image}</View> : image;
}
