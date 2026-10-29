// The synagogue-chair glyph (UX §15.10.3) as an SVG string, drawn by expo-image from a data URI like Icon. The wood always
// stays wood; only the upholstery (book-rest, back panel, cushion) carries the state.
import { ICON_PATHS } from '../kit/iconPaths.ts';

export type ChairState = 'kept' | 'free' | 'other';
export type ChairIcon = 'user' | 'check' | 'lock';

export const CHAIR_COLORS = {
  light: { wood: '#B87A43', shade: '#8C5A2E', line: '#6B4321', kept: '#B8322E', keptIcon: '#FFFFFF', free: '#9ED8AA', freeIcon: '#1B4D27', freeLine: '#256B35' },
  dark: { wood: '#A86E3B', shade: '#7A4D27', line: '#4A2E14', kept: '#F0857F', keptIcon: '#10132A', free: '#6FC283', freeIcon: '#0C2414', freeLine: '#8FD49C' },
} as const;

type Part = { tag: 'rect' | 'path'; attrs: string; kind: 'w' | 'dk' | 'u' };
// From P37's `svg.ch` (viewBox 0 0 50 62), back to front.
const PARTS: Part[] = [
  { tag: 'rect', attrs: 'x="13" y="0.8" width="24" height="4.6" rx="2.3"', kind: 'u' },
  { tag: 'path', attrs: 'd="M11.5 6h27v33h-27z"', kind: 'dk' },
  { tag: 'path', attrs: 'd="M4 3.5h7.5v51H2.4z"', kind: 'w' },
  { tag: 'path', attrs: 'd="M46 3.5h-7.5v51h9.1z"', kind: 'w' },
  { tag: 'rect', attrs: 'x="10" y="4.6" width="30" height="3.2" rx="1"', kind: 'w' },
  { tag: 'rect', attrs: 'x="14.2" y="9.6" width="21.6" height="26" rx="4"', kind: 'u' },
  { tag: 'rect', attrs: 'x="0.6" y="27" width="13.4" height="3.4" rx="1.4"', kind: 'w' },
  { tag: 'rect', attrs: 'x="36" y="27" width="13.4" height="3.4" rx="1.4"', kind: 'w' },
  { tag: 'rect', attrs: 'x="9.6" y="37.4" width="30.8" height="8.2" rx="3"', kind: 'u' },
  { tag: 'rect', attrs: 'x="12" y="48" width="26" height="2.4"', kind: 'dk' },
  { tag: 'rect', attrs: 'x="0" y="55" width="17" height="4.6" rx="2"', kind: 'w' },
  { tag: 'rect', attrs: 'x="33" y="55" width="17" height="4.6" rx="2"', kind: 'w' },
];
// The icon is 19 px when the chair is 56 high (62 units): 19 * 62 / 56 units, centred on the back panel (25, 22.6).
const ICON_UNITS = Math.round(((19 * 62) / 56) * 10) / 10;

export function chairSvg(o: { state: ChairState; icon: ChairIcon | null; dark: boolean; grey: { fill: string; seam: string } }): string {
  const c = o.dark ? CHAIR_COLORS.dark : CHAIR_COLORS.light;
  const shape = (p: Part): string => {
    let style: string;
    if (o.state === 'other') style = `fill="${o.grey.fill}" stroke="${o.grey.seam}" stroke-width="1"`;
    else if (p.kind === 'u') {
      style = o.state === 'kept'
        ? `fill="${c.kept}" stroke="${c.line}" stroke-width=".8"`
        : `fill="${c.free}" stroke="${c.freeLine}" stroke-width="1.8" stroke-dasharray="3 2"`;
    } else style = `fill="${p.kind === 'dk' ? c.shade : c.wood}" stroke="${c.line}" stroke-width=".8"`;
    return `<${p.tag} ${p.attrs} ${style}/>`;
  };
  let icon = '';
  if (o.icon) {
    const color = o.state === 'kept' ? c.keptIcon : o.state === 'free' ? c.freeIcon : o.grey.seam;
    icon = `<svg x="${(25 - ICON_UNITS / 2).toFixed(2)}" y="${(22.6 - ICON_UNITS / 2).toFixed(2)}" width="${ICON_UNITS}" height="${ICON_UNITS}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[o.icon]}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="62" viewBox="0 0 50 62">${PARTS.map(shape).join('')}${icon}</svg>`;
}
