// Parts of the illustrated family-tree figures (UX-DESIGN §17.13, frames P34/P35). Everything is drawn in the
// "B" frame: a head of radius 26 centred on (50, 46) over shoulders, in a 100 x 100 box. Direction A (full body)
// places the very same head parts on a body with a transform, so both directions read as one family.
// Pure string builders: no state, no I/O. Colours are literal (the art keeps its colours in dark mode).
import type { FigureOptions } from '../types.ts';

export type Kind = 'baby' | 'toddler' | 'child' | 'preteen' | 'teen' | 'youngAdult' | 'adult' | 'older';
export type Gender = 'm' | 'f';
type Covering = NonNullable<FigureOptions['headCovering']>;
type Kippah = NonNullable<FigureOptions['kippah']>;
type Beard = NonNullable<FigureOptions['beard']>;

export const SKIN = [
  { face: '#F1C7A2', shade: '#E3AE88' },
  { face: '#E2AC82', shade: '#CF946A' },
  { face: '#C98D63', shade: '#B07650' },
] as const;
export const HAIR = { brown: '#5A3B28', black: '#2B2320', auburn: '#94502C', blond: '#C9973F', grey: '#A9AEBB', white: '#E6E6EA' } as const;
export const COVER_COLORS = ['#2F8F8A', '#D0655A', '#5C7FC9', '#C0567A', '#5F7F3A', '#6D5E95'] as const; // teal, coral, blue, rose, olive, purple
export const TEKHELET = '#2A3F94';
export const BERET = '#5F7F3A';
export const KNIT = [{ c: TEKHELET, ring: '#FFFFFF' }, { c: '#5F7F3A', ring: '#E9C67A' }, { c: '#7D92DE', ring: '#FFFFFF' }] as const;
export const SHIRT_M = ['#B9C6EE', '#EDE8DA', '#E9C67A', '#93B26A', '#7D92DE'] as const;
export const SHIRT_F = ['#F2B8C4', '#DD7C92', '#E9C67A', '#93B26A', '#B9C6EE'] as const;
const INK = '#2A2238';
const PINK = '#EE8C8C';

/** Numbers in the markup: one decimal, never NaN. */
export const n = (x: number) => String(Math.round((Number.isFinite(x) ? x : 0) * 10) / 10);

/** Only a plain #rgb / #rrggbb colour is let into the markup; anything else falls back (no injection through options). */
export function safeColor(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toUpperCase();
  return fallback;
}
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
/** Mix a colour towards white (t = 0..1). */
export function tint(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  return ('#' + hex2(r + (255 - r) * t) + hex2(g + (255 - g) * t) + hex2(b + (255 - b) * t)).toUpperCase();
}
/** The "ash" look for the deceased: every colour becomes a grey of the same lightness, at a softer contrast
 *  (what `filter: grayscale(1) contrast(.85)` does, done on the colours so no SVG filter is needed). */
export function ash(markup: string, dark = false): string {
  return markup.replace(/#[0-9a-fA-F]{6}\b/g, hex => {
    const [r, g, b] = rgb(hex);
    const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const lum = dark ? 0.38 + y * 0.55 : (y - 0.5) * 0.85 + 0.5; // on a dark tile the darkest greys would vanish
    const v = hex2(lum * 255);
    return ('#' + v + v + v).toUpperCase();
  });
}

export type Look = {
  kind: Kind; gender: Gender; skin: 0 | 1 | 2; hair: string;
  covering: Covering; coverColor: string; kippah: Kippah; beard: Beard; glasses: boolean;
  knit: { c: string; ring: string }; shirt: string;
};

const circle = (cx: number, cy: number, r: number, fill: string, extra = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${extra}/>`;
const stroke = (d: string, color: string, w: number, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(w)}" stroke-linecap="round"${extra}/>`;
const fillPath = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;

const isKid = (k: Kind) => k === 'toddler' || k === 'child';
const adultFace = (k: Kind) => !isKid(k) && k !== 'baby';
const isElder = (k: Kind) => k === 'older';

// ---- the head -------------------------------------------------------------------------------------------------
/** The head, in B coordinates. `back` is drawn before the body (long hair, plaits, the tichel's tail), `face` after it. */
export function head(l: Look): { back: string; face: string; radius: number } {
  const skin = SKIN[l.skin] ?? SKIN[0];
  const back: string[] = [];
  const out: string[] = [];
  const baby = l.kind === 'baby', kid = isKid(l.kind);
  const R = baby ? 27 : 26;

  // ears + head
  if (baby) out.push(circle(23.8, 49.2, 5.4, skin.shade), circle(76.2, 49.2, 5.4, skin.shade));
  else out.push(circle(24.8, 49.1, 5.2, skin.shade), circle(75.2, 49.1, 5.2, skin.shade));
  out.push(circle(50, 46, R, skin.face));

  const female = l.gender === 'f';
  const covering = l.covering;
  const covered = female && adultFace(l.kind) && l.kind !== 'preteen' && covering !== 'none';
  const wig = covered && covering === 'wig', tichel = covered && covering === 'tichel', beret = covered && covering === 'hat';
  const beard = !female && adultFace(l.kind) && l.kind !== 'preteen' ? l.beard : 'none';

  // beard (right after the head so the face parts sit on it)
  if (beard !== 'none') {
    const low = beard === 'short' ? [77.2, 79.3] : isElder(l.kind) ? [99.3, 101.4] : [85, 87.1];
    out.push(fillPath(`M24.5 47.3Q24.5 ${low[0]} 50 ${low[1]}Q75.5 ${low[0]} 75.5 47.3Q66.1 66.3 50 64.2Q33.9 66.3 24.5 47.3Z`, l.hair));
    out.push(stroke('M41.7 57.4Q50 53.8 58.3 57.4', l.hair, 4.2));
  }

  // face
  if (baby) {
    out.push(circle(34.9, 60.9, 4.1, PINK, ' opacity=".45"'), circle(65.1, 60.9, 4.1, PINK, ' opacity=".45"'));
    out.push(`<ellipse cx="40.3" cy="52.8" rx="2.3" ry="3" fill="${INK}"/><ellipse cx="59.7" cy="52.8" rx="2.3" ry="3" fill="${INK}"/>`);
    out.push(circle(41.1, 51.7, 0.8, '#fff'), circle(60.5, 51.7, 0.8, '#fff'));
    out.push(`<path d="M43.5 62Q50 68.4 56.5 62" fill="none" fill-opacity=".9" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`);
  } else if (kid) {
    out.push(circle(35.4, 58.5, 3.9, PINK, ' opacity=".45"'), circle(64.6, 58.5, 3.9, PINK, ' opacity=".45"'));
    out.push(`<ellipse cx="40.6" cy="50.7" rx="2.7" ry="3.4" fill="${INK}"/><ellipse cx="59.4" cy="50.7" rx="2.7" ry="3.4" fill="${INK}"/>`);
    out.push(circle(41.4, 49.4, 0.9, '#fff'), circle(60.1, 49.4, 0.9, '#fff'));
    out.push(`<path d="M43.8 59.5Q50 65.8 56.2 59.5" fill="none" fill-opacity=".9" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`);
  } else {
    out.push(circle(35.4, 55.4, 3.9, PINK, ' opacity=".45"'), circle(64.6, 55.4, 3.9, PINK, ' opacity=".45"'));
    if (isElder(l.kind)) out.push(`<path d="M37 47.6q3.6 -3.6 7.3 0M55.7 47.6q3.6 -3.6 7.3 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`);
    else out.push(`<ellipse cx="40.6" cy="47.6" rx="2.1" ry="2.7" fill="${INK}"/><ellipse cx="59.4" cy="47.6" rx="2.1" ry="2.7" fill="${INK}"/>`, circle(41.4, 46.6, 0.7, '#fff'), circle(60.1, 46.6, 0.7, '#fff'));
    if (beard !== 'none') out.push(`<path d="M43.8 56.9Q50 63.2 56.2 56.9" fill="#fff" fill-opacity=".9" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`);
    else out.push(`<path d="M43.8 56.4Q50 62.6 56.2 56.4" fill="none" fill-opacity=".9" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`);
  }

  // hair, head coverings, kippah
  const capM = 'M23.5 51.2C21.4 11.7 78.6 11.7 76.5 51.2Q72.1 36.1 53.9 32.5Q35.7 34.3 23.5 51.2Z';
  const capF = 'M23.5 57.7C21.4 11.7 78.6 11.7 76.5 57.7Q72.1 36.1 53.9 32.5Q35.7 34.3 23.5 57.7Z';
  const ribbon = '#A32A47';
  const bow = (x: number, y: number, c: string, k = 1) => fillPath(`M${n(x)} ${n(y)}l${n(8.7 * k)} ${n(-5.4 * k)}v${n(10.8 * k)}zM${n(x)} ${n(y)}l${n(-2.7 * k)} ${n(-8.1 * k)}l${n(-5.4 * k)} ${n(11.4 * k)}z`, c);
  const curls = () => ([[31.8, 30.4], [42.2, 22.1], [53.9, 20.5], [65.6, 27.3], [72.9, 38.2], [26.1, 39.5]] as [number, number][]).map(([x, y]) => circle(x, y, 8.8, l.hair)).join('');
  const kippahDraw = () => {
    if (l.kippah === 'none') return '';
    if (l.kippah === 'velvet') return fillPath('M28.2 30.6A27.6 27.6 0 0 1 73.3 29.8Q51 27.5 28.2 30.6Z', '#1F1D2B') + stroke('M39.3 20.5Q51 17.9 58.8 20', '#fff', 1.6, ' stroke-opacity=".28"');
    if (l.kippah === 'small') return fillPath('M39.3 22.1A27.6 27.6 0 0 1 66.9 22.1Q53.1 26.2 39.3 22.1Z', l.knit.c);
    return fillPath('M28.2 30.6A27.6 27.6 0 0 1 73.3 29.8Q51 27.5 28.2 30.6Z', l.knit.c) + stroke('M33.8 26.9A25.7 25.7 0 0 1 67.6 26.3', l.knit.ring, 1.8);
  };

  if (baby) {
    if (female) out.push(stroke('M25.1 35.2Q50 13.6 74.9 35.2', ribbon, 4.3), bow(60.3, 19.5, ribbon));
    else out.push(stroke('M47.3 20.3q4.1 -13.5 12.2 -8.1q-8.1 -0.5 -5.4 8.7', l.hair, 3.2));
  } else if (l.kind === 'toddler') {
    out.push(curls());
    if (female) out.push(stroke('M26.1 35.6Q50 14.8 73.9 35.6', TEKHELET, 4.2), bow(59.9, 20.5, TEKHELET, 0.96));
  } else if (female) {
    // girls and women
    if (l.kind === 'child') {
      for (const x of [23.5, 76.5]) ([[52.5, 6.2], [60.8, 5.7], [69.1, 5.2]] as [number, number][]).forEach(([y, r]) => back.push(circle(x, y, r, l.hair)));
      out.push(fillPath(capF, l.hair));
      out.push(fillPath('M23.5 72l-5.7 5.2l11.4 0z', TEKHELET), fillPath('M76.5 72l-5.7 5.2l11.4 0z', TEKHELET));
    } else if (l.kind === 'preteen') {
      back.push(`<ellipse cx="77.3" cy="53.8" rx="9.9" ry="22.1" fill="${l.hair}" transform="rotate(-18 77.3 53.8)"/>`, circle(71.3, 31.7, 5.2, ribbon));
      out.push(fillPath(capF, l.hair));
    } else if (tichel) {
      const c = l.coverColor, dot = tint(c, 0.78);
      back.push(fillPath('M35.7 48.6C21.4 69.4 12.3 87.6 16.2 104.5Q22.7 109.7 28.7 103.2C27.9 85 37 66.8 47.4 53.8Z', c));
      back.push(stroke('M20.9 90.2Q24 95.4 27.1 101.9', '#000', 2.1, ' stroke-opacity=".15"'));
      back.push(`<ellipse cx="53.1" cy="31.7" rx="31.2" ry="25.5" fill="${c}"/>`);
      for (const [x, y] of [[22.7, 77.2], [18.8, 91.5], [24.5, 100.6], [74.7, 21.3], [78.6, 35.6]] as [number, number][]) back.push(circle(x, y, 1.8, dot));
      out.push(fillPath('M26.1 45.5Q40.9 38.2 53.9 40.3Q66.1 41.3 73.9 45.5L73.9 31.7H26.1Z', l.hair));
      out.push(fillPath('M21.9 51.2C17.8 5.7 82.2 5.7 78.1 51.2Q70.3 36.6 50 34Q29.7 36.6 21.9 51.2Z', c));
      out.push(stroke('M24.5 41.3Q44.8 14.8 78.1 29.9', '#000', 4.2, ' stroke-opacity=".16"'));
      out.push(stroke('M29.7 37.7Q50 30.9 70.3 37.7', '#fff', 1.6, ' stroke-opacity=".22"'));
      for (const [x, y] of [[33.9, 24.7], [60.9, 22.1], [68.2, 15.3]] as [number, number][]) out.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="2.6" ry="1.3" transform="rotate(-30 ${n(x)} ${n(y)})" fill="${dot}"/>`);
      for (const [x, y] of [[46.9, 18.7], [71.3, 33], [27.1, 37.7], [53.1, 27.3], [39.6, 13.5]] as [number, number][]) out.push(circle(x, y, 1.4, dot));
    } else if (beret) {
      const c = l.coverColor;
      back.push(fillPath('M21.9 38.2V56.9Q21.9 63.2 29.2 62.1H70.8Q78.1 63.2 78.1 56.9V38.2Z', l.hair));
      out.push(fillPath('M24.5 38.2Q42.2 47.6 52.6 42.9Q65.6 47.6 75.5 38.2Z', l.hair));
      out.push(fillPath('M21.4 41.3C5.3 36.9 10.5 5.7 51.3 6.5C93.2 7 95.8 35.6 78.6 41.3Q50 34 21.4 41.3Z', c));
      out.push(stroke('M26.6 20.5Q46.1 9.1 70.8 16.9', '#fff', 3.1, ' stroke-opacity=".2"'));
      out.push(stroke('M20.9 38.7Q50 30.4 79.1 38.7', '#E9C67A', 2.6));
      out.push(circle(73.4, 35.1, 1.8, c));
      for (const [x, y] of [[77.8, 32.5], [77.8, 38.2], [70.3, 31.7], [70.3, 38.2]] as [number, number][]) out.push(circle(x, y, 2.3, '#E9C67A'));
    } else if (wig) {
      back.push(fillPath('M20.4 43.4C16.2 8.3 83.8 8.3 79.6 43.4C81.7 64.2 77.3 74.6 86.9 79.8Q73.4 86.3 64.3 77.2H35.7Q26.6 86.3 13.1 79.8C22.7 74.6 18.3 64.2 20.4 43.4Z', l.hair));
      out.push(fillPath('M21.9 52.5C18.8 9.6 81.2 9.6 78.1 52.5Q74.7 36.9 59.1 29.9Q38.3 40.8 21.9 52.5Z', l.hair));
      out.push(stroke('M59.1 29.9Q55.2 20 57.8 16.9', '#fff', 1.8, ' stroke-opacity=".18"'));
    } else if (isElder(l.kind)) {
      // grey bun, no covering
      back.push(circle(50, 18.7, 10.9, l.hair));
      out.push(fillPath(capF, l.hair));
    } else {
      // teen / young woman / woman with her hair uncovered: long hair
      back.push(fillPath('M20.9 46C18.8 10.9 81.2 10.9 79.1 46L81.2 83.7Q50 91.5 18.8 83.7Z', l.hair));
      out.push(fillPath(capF, l.hair));
    }
  } else {
    // boys and men
    out.push(fillPath(capM, l.hair));
    out.push(kippahDraw());
  }
  if (l.glasses && adultFace(l.kind)) out.push(`<g fill="none" stroke="${INK}" stroke-width="1.8"><circle cx="40.6" cy="47.6" r="6.5"/><circle cx="59.4" cy="47.6" r="6.5"/><path d="M47.1 47.6h5.7"/></g>`);
  return { back: back.join(''), face: out.join(''), radius: R };
}

// ---- bodies, direction B (shoulders in the disc) -------------------------------------------------------------
const NECK_B = (shade: string) => fillPath('M43 67.9L50 76.9L57 67.9Z', shade);
/** Shoulders, neck (and the waving arm of toddlers and children), in B coordinates. Bottom edge runs far below the frame. */
export function bodyB(l: Look): string {
  const skin = SKIN[l.skin] ?? SKIN[0];
  const sh = l.shirt, female = l.gender === 'f';
  const torso = (x: number) => `M${x} 160V100Q${x} 69.9 50 67.9Q${100 - x} 69.9 ${100 - x} 100V160Z`;
  switch (l.kind) {
    case 'baby': return fillPath('M14.8 160V100Q10.8 40.6 50 10.8Q89.2 40.6 85.2 100V160Z', sh);
    case 'toddler': case 'child': {
      const x = 24;
      return fillPath(torso(x), sh) + NECK_B(skin.shade) + stroke('M70.8 98L79.9 63.9', sh, 9) + circle(80.4, 60.9, 5, skin.face);
    }
    case 'preteen': return fillPath(torso(20), sh) + NECK_B(skin.shade);
    default: {
      let s = fillPath(torso(female ? 18 : 16), sh);
      if (!female && l.kind !== 'teen') s += fillPath('M22.8 160V100Q26.2 73.9 44 71.9L48 160ZM77.2 160V100Q73.8 73.9 56 71.9L52 160Z', l.kind === 'older' ? '#5E6380' : l.kind === 'adult' ? TEKHELET : '#4A5585');
      return s + NECK_B(skin.shade);
    }
  }
}

// ---- bodies, direction A (whole standing person) -----------------------------------------------------------------
type Frame = {
  hcy: number; hr: number; ty: number; hem: number; legTop: number; w: number; viewBox: string;
};
// head centre, head radius, torso top, hem, top of the legs, torso half-width; viewBox crops to the figure like the P34 tile does.
export const FRAME: Record<Kind, { m: Frame; f: Frame }> = (() => {
  const mk = (hcy: number, hr: number, ty: number, hem: number, legTop: number, w: number, viewBox: string): Frame => ({ hcy, hr, ty, hem, legTop, w, viewBox });
  return {
    baby: { m: mk(108, 13.8, 0, 0, 0, 0, '19 72.5 62 77.5'), f: mk(108, 13.8, 0, 0, 0, 0, '19 72.5 62 77.5') },
    toddler: { m: mk(91.5, 15.5, 108.5, 126.8, 123.8, 14.7, '12.6 56.6 74.7 93.4'), f: mk(91.5, 15.5, 108.5, 126.8, 123.8, 14, '12.6 56.6 74.7 93.4') },
    child: { m: mk(69.5, 15.5, 86.5, 114.9, 111.9, 14.7, '3.8 34.6 92.3 115.4'), f: mk(69.5, 15.5, 86.5, 114.9, 111.9, 14, '3.8 34.6 92.3 115.4') },
    preteen: { m: mk(50.5, 14.5, 68, 103.3, 100.3, 17.1, '0 25.1 99.9 124.9'), f: mk(50.5, 14.5, 68, 103.3, 100.3, 14.5, '0 25.1 99.9 124.9') },
    teen: { m: mk(34, 14, 51, 93.8, 90.8, 16.5, '-6.2 9.5 112.4 140.5'), f: mk(34, 14, 51, 93.8, 90.8, 14, '-6.2 9.5 112.4 140.5') },
    youngAdult: { m: mk(26, 14, 43, 89.3, 86.3, 16.5, '-9.4 1.5 118.8 148.5'), f: mk(26, 14, 43, 89.3, 86.3, 14, '-9.4 1.5 118.8 148.5') },
    adult: { m: mk(23.5, 14.5, 41, 88.2, 85.2, 17.1, '-10.8 -1.9 121.5 151.9'), f: mk(23.5, 14.5, 41, 88.2, 85.2, 14.5, '-10.8 -1.9 121.5 151.9') },
    older: { m: mk(27.5, 14.5, 45, 90.4, 87.4, 17.1, '-9.2 2.1 118.3 147.9'), f: mk(27.5, 14.5, 45, 90.4, 87.4, 14.5, '-9.2 2.1 118.3 147.9') },
  };
})();

export const frameOf = (kind: Kind, gender: Gender): Frame => FRAME[kind][gender];

/** A whole standing person: the head parts placed with a transform on a body. */
export function figureA(l: Look): { markup: string; viewBox: string } {
  const fr = frameOf(l.kind, l.gender);
  const skin = SKIN[l.skin] ?? SKIN[0];
  const hd = head(l);
  const s = fr.hr / hd.radius;
  const place = (inner: string) => inner ? `<g transform="translate(50 ${n(fr.hcy)}) scale(${Math.round(s * 10000) / 10000}) translate(-50 -46)">${inner}</g>` : '';
  const f = fr.hr / 14;
  const female = l.gender === 'f';
  const parts: string[] = [];
  const shadow = (rx: number) => `<ellipse cx="50" cy="145" rx="${n(rx)}" ry="2.6" fill="#000" opacity=".08"/>`;
  parts.push(place(hd.back));

  if (l.kind === 'baby') {
    parts.length = 0;
    parts.push(shadow(20), place(hd.back));
    parts.push(fillPath('M29 114.5C26 144.5 40 156.5 50 156.5C60 156.5 74 144.5 71 114.5C68 83 32 83 29 114.5Z', l.shirt));
    parts.push(place(hd.face));
    parts.push(fillPath('M35 122.5Q50 116.5 65 122.5Q50 134.5 35 122.5Z', '#fff', ' opacity=".45"'));
    return { markup: parts.join(''), viewBox: fr.viewBox };
  }

  const kid = l.kind === 'toddler' || l.kind === 'child';
  const hem = fr.hem, ty = fr.ty, w = fr.w, lt = fr.legTop;
  const pants = l.kind === 'child' || l.kind === 'preteen' ? '#4A5585' : l.kind === 'toddler' ? '#4A5585' : '#3A3F5C';
  const legsH = 142 - lt;
  const lw = kid ? 9.4 : female ? 9 * f : 10.6 * f, lx = female ? 10 * f : 11.8 * f, lg = female ? 1 * f : 1.2 * f;
  const shoeRx = (female || kid ? 6.4 : 7.6) * f, shoeDx = female || kid ? 7.1 * f : 7.9 * f;
  const leg = (x: number, color: string) => `<rect x="${n(x)}" y="${n(lt)}" width="${n(lw)}" height="${n(legsH)}" rx="${n(lw * 0.4)}" fill="${color}"/>`;
  const shoe = (cx: number) => `<ellipse cx="${n(cx)}" cy="143.2" rx="${n(shoeRx)}" ry="3.1" fill="#2E2A3C"/>`;
  parts.push(shadow(female ? 21.8 * f : (kid ? 22.1 : 24.8 * f)));
  const legColor = female ? skin.face : pants;
  parts.push(leg(50 - lx, legColor), shoe(50 - shoeDx), leg(50 + lg, legColor), shoe(50 + shoeDx));
  if (!female && kid) { // shorts: bare calves
    const kneeY = l.kind === 'child' ? 126.5 : 133.4;
    for (const x of [50 - lx, 50 + lg]) parts.push(`<rect x="${n(x)}" y="${n(kneeY)}" width="${n(lw)}" height="${n(l.kind === 'child' ? 12.1 : 7.3)}" fill="${skin.face}"/>`);
  }
  // torso
  const cr = 7.2 * f, top = 7.7 * f;
  parts.push(fillPath(`M${n(50 - w)} ${n(ty + top)}Q${n(50 - w)} ${n(ty)} ${n(50 - w + cr)} ${n(ty)}H${n(50 + w - cr)}Q${n(50 + w)} ${n(ty)} ${n(50 + w)} ${n(ty + top)}L${n(50 + w - 3 * f)} ${n(hem)}H${n(50 - w + 3 * f)}Z`, l.shirt));
  // skirt
  if (female) {
    const flare = kid ? (l.kind === 'child' ? 130.4 : 135.8) : 136;
    const sk = kid ? 11.5 : 11.5 * f, skb = kid ? 16.6 : 16.6 * f;
    const skirtColor = kid ? l.shirt : l.kind === 'preteen' ? '#5F7F3A' : l.kind === 'teen' ? TEKHELET : l.kind === 'adult' ? TEKHELET : '#4A5585';
    parts.push(fillPath(`M${n(50 - sk)} ${n(lt - 2)}H${n(50 + sk)}L${n(50 + skb)} ${n(flare)}Q50 ${n(flare + 3)} ${n(50 - skb)} ${n(flare)}Z`, skirtColor));
  }
  if (!female) {
    // tzitzit strings (from age 4, not on the oldest generation)
    if (l.kind !== 'older') for (const sgn of [-1, 1]) parts.push(`<path d="M${n(50 + sgn * 12.2 * f)} ${n(hem - 2)}v${n(13.1 * f)}M${n(50 + sgn * 10.2 * f)} ${n(hem - 2)}v${n(10.9 * f)}" stroke="#fff" stroke-width="1.1" stroke-linecap="round" fill="none"/>`);
    if (!kid && l.kind !== 'preteen' && l.kind !== 'teen') parts.push(fillPath(`M${n(50 - w + 1)} ${n(ty + 2)}L48 ${n(lt + 1)}H${n(50 - w + 3 * f)}ZM${n(50 + w - 1)} ${n(ty + 2)}L52 ${n(lt + 1)}H${n(50 + w - 3 * f)}Z`, l.kind === 'older' ? '#5E6380' : l.kind === 'adult' ? TEKHELET : '#4A5585'));
  }
  // neck
  const nk = (kid ? 8.7 : 7.8 * f);
  parts.push(`<rect x="${n(50 - nk / 2)}" y="${n(ty - 6.5 * f)}" width="${n(nk)}" height="${n(8.6 * f)}" fill="${skin.shade}"/>`);
  parts.push(fillPath(`M${n(50 - 6.3 * f)} ${n(ty)}L50 ${n(ty + 6.3 * f)}L${n(50 + 6.3 * f)} ${n(ty)}Z`, skin.shade));
  // arms and hands
  const ax = (female ? 11.2 : 13.7) * f, ex = (female ? 17.5 : 20) * f, aw = (kid ? 7.8 : 7.3 * f), hr = kid ? 4.2 : 3.9 * f;
  const arm = (sgn: number, wave: boolean) => {
    const x0 = 50 + sgn * (kid ? 11.4 : ax), y0 = ty + (kid ? 4.7 : 4.4 * f);
    if (wave) return `<path d="M${n(x0)} ${n(y0)}L${n(78.7)} ${n(ty - 14)}" stroke="${l.shirt}" stroke-width="${n(aw)}" stroke-linecap="round" fill="none"/>` + circle(78.7, ty - 15, hr, skin.face);
    const x1 = 50 + sgn * (kid ? 18.4 : ex), y1 = hem + 1;
    return `<path d="M${n(x0)} ${n(y0)}L${n(x1)} ${n(y1)}" stroke="${l.shirt}" stroke-width="${n(aw)}" stroke-linecap="round" fill="none"/>` + circle(x1, y1 + 1.5 * (kid ? 1 : f), hr, skin.face);
  };
  parts.push(arm(-1, false), arm(1, kid));
  parts.push(place(hd.face));
  return { markup: parts.join(''), viewBox: fr.viewBox };
}

// ---- badge, ghost, marker ------------------------------------------------------------------------------------------
/** The memorial candle badge (§17.15, P34): a small disc with a glass candle and a LIT flame (orange, with a soft glow). */
export function candleBadge(cx: number, cy: number, r: number, dark: boolean): string {
  const k = r / 13;
  const surface = dark ? '#1A1E3A' : '#FFFFFF', line = dark ? '#2E3358' : '#DDE0D4';
  const glass = dark ? '#D9D2BF' : '#F4EEDD', rim = dark ? '#B9AE96' : '#8A7E6A';
  return `<g data-candle="1" transform="translate(${n(cx)} ${n(cy)}) scale(${String(Math.round(k * 1000) / 1000)})">`
    + `<circle r="13" fill="${surface}" stroke="${line}" stroke-width="1"/>`
    + `<circle cx="0" cy="-4.5" r="6" fill="#FFB547" fill-opacity="${dark ? '.4' : '.3'}"/>`
    + `<rect x="-4" y="0" width="8" height="9" rx="2" fill="${glass}" stroke="${rim}" stroke-width="1.2"/>`
    + `<path d="M0 -10C2.2 -7.4 3 -6 3 -4.4a3 3 0 0 1 -6 0C-3 -6 -2.2 -7.4 0 -10Z" fill="#F28C1C"/>`
    + `<path d="M0 -7.2C1 -6.1 1.4 -5.4 1.4 -4.7a1.4 1.4 0 0 1 -2.8 0C-1.4 -5.4 -1 -6.1 0 -7.2Z" fill="#FFE08A"/></g>`;
}
/** The "ill" badge: a soft-rose heart with a pulse line in a white circle with a rose ring (never alarm red). */
export function healBadge(cx: number, cy: number, r: number, dark: boolean): string {
  const k = r / 13;
  const surface = dark ? '#1A1E3A' : '#FFFFFF', rose = dark ? '#F2A6C0' : '#B8507A';
  return `<g data-heal="1" transform="translate(${n(cx)} ${n(cy)}) scale(${String(Math.round(k * 1000) / 1000)})">`
    + `<circle r="13" fill="${surface}" stroke="${rose}" stroke-width="1.2"/>`
    + `<g transform="translate(-9.5 -9.5) scale(.79)">`
    + `<path d="M12 20.6s-7.8-4.7-7.8-10.4A4.4 4.4 0 0 1 12 7.5a4.4 4.4 0 0 1 7.8 2.7c0 5.7-7.8 10.4-7.8 10.4z" fill="${rose}" fill-opacity=".25" stroke="${rose}" stroke-width="1.8" stroke-linejoin="round"/>`
    + `<path d="M5 12.6h3.4l1.5-2.8 2.3 5.2 1.7-3.4H19" fill="none" stroke="${rose}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;
}
export function ghost(style: 'A' | 'B'): { inner: string; viewBox: string } {
  if (style === 'B') return { inner: '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="5 5" stroke-linecap="round"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="42" r="17"/><path d="M22 90q4-24 28-24t28 24"/></g>', viewBox: '0 0 100 100' };
  return { inner: '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="5 5" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="38" r="15"/><path d="M33 142V80Q33 62 50 62Q67 62 67 80V142Z"/></g>', viewBox: '10 20 80 130' };
}
