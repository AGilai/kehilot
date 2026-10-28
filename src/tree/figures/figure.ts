// Parametric family-tree figures (UX-DESIGN §17.3, §17.13). `figureSvg` returns a self-contained SVG string
// (no external references, no CSS variables: it is shown through an <img>, like kit/Icon.tsx).
import { hebrewAge } from '../dates.ts';
import type { FigureOptions, HebDate, Relation } from '../types.ts';
import { ash, bodyB, candleBadge, healBadge, COVER_COLORS, figureA, frameOf, ghost, head, HAIR, KNIT, n, safeColor, SHIRT_F, SHIRT_M, BERET, TEKHELET } from './parts.ts';
import type { Gender, Kind, Look } from './parts.ts';

/** baby 0-1, toddler 1-3, child 4-8, preteen 9-12 boys / 9-11 girls, teen 13-17 boys / 12-17 girls, youngAdult 18+, adult (our generation), older (parents and up). */
export type AgeStage = Kind;

/** Children grow with age by the Hebrew birth date; the generations above and beside them have a fixed stage.
 *  No birth date: child 4-8. Girls become a teen (נערה) at 12, the bat mitzvah; boys at 13. `today` is 'YYYY-MM-DD' or a Date. */
export function stageOf(birth: HebDate | undefined, relation: Relation, today: string | Date, gender: Gender = 'm'): AgeStage {
  if (relation === 'father' || relation === 'mother') return 'older';
  if (relation !== 'child' && relation !== 'grandchild') return 'adult';
  if (!birth || birth.year === undefined) return 'child';
  const iso = typeof today === 'string' ? today : [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  let age: number;
  try { age = hebrewAge(birth, iso); } catch { return 'child'; }
  if (age < 1) return 'baby';
  if (age < 4) return 'toddler';
  if (age < 9) return 'child';
  if (age < (gender === 'f' ? 12 : 13)) return 'preteen';
  if (age < 18) return 'teen';
  return 'youngAdult';
}

/** What a person looks like before they choose: it follows generation, gender and age (owner decisions, 2026-10-28). */
export function defaultFigure(relation: Relation, gender: Gender, stage: AgeStage): FigureOptions {
  const base: FigureOptions = { skin: 1, glasses: false };
  if (gender === 'm') {
    if (stage === 'baby' || stage === 'toddler') return { ...base, hair: HAIR.brown };
    const elder = stage === 'older';
    return {
      ...base, hair: elder ? HAIR.white : HAIR.brown, kippah: 'knitted',
      beard: stage === 'adult' || elder ? (elder ? 'full' : 'short') : 'none', glasses: elder,
    };
  }
  // women
  if (stage === 'older') return { ...base, headCovering: 'hat', coverColor: BERET, glasses: true, hair: HAIR.grey };
  if (stage === 'adult' && (relation === 'self' || relation === 'spouse' || relation === 'childSpouse' || relation === 'formerSpouse')) return { ...base, headCovering: 'tichel', coverColor: pick(COVER_COLORS, 0), hair: HAIR.brown };
  return { ...base, headCovering: 'none', hair: HAIR.brown };
}

/** The default with the person's own choices on top; every field is filled. */
export function resolveFigure(relation: Relation, gender: Gender, stage: AgeStage, own?: FigureOptions): FigureOptions {
  const d = defaultFigure(relation, gender, stage);
  const out: FigureOptions = { ...d };
  if (own) for (const k of Object.keys(own) as (keyof FigureOptions)[]) if (own[k] !== undefined) (out as Record<string, unknown>)[k] = own[k];
  return out;
}

export type FigureArgs = { style: 'A' | 'B'; stage: AgeStage; gender: Gender; options: FigureOptions; deceased: boolean; ill?: boolean; dark: boolean; seed?: number };
type Member = { stage: AgeStage; gender: Gender; options: FigureOptions; seed?: number; deceased?: boolean; ill?: boolean };

const DISC = { light: '#EAEDE2', dark: '#283058' };
const SPOT = { light: { c: '#2A3F94', o: '.2' }, dark: { c: '#8FA2F0', o: '.38' } };
const MUTED = { light: '#555B75', dark: '#AEB4CC' };

const pick = <T,>(arr: readonly T[], i: number): T => arr[i % arr.length] as T;
function lookOf(m: Member): Look {
  const o = m.options ?? {}, seed = Math.abs(Math.trunc(m.seed ?? 0)) || 0;
  const kind = m.stage, female = m.gender === 'f';
  const shirts = female ? SHIRT_F : SHIRT_M;
  const elder = kind === 'older';
  const shirt = kind === 'baby' ? pick(shirts, 0) : elder ? (female ? '#C99A3B' : '#8A8FA6') : kind === 'adult' && female ? pick(shirts, 1) : pick(shirts, seed);
  const knit = kind === 'adult' || kind === 'older' ? pick(KNIT, 0) : pick(KNIT, seed);
  const skin = o.skin === 0 || o.skin === 1 || o.skin === 2 ? o.skin : 1;
  const coverDefault = female && elder ? BERET : female ? pick(COVER_COLORS, seed) : TEKHELET;
  const coverColor = safeColor(o.coverColor, coverDefault);
  return {
    kind, gender: m.gender, skin, hair: safeColor(o.hair, elder ? (female ? HAIR.grey : HAIR.white) : HAIR.brown),
    covering: o.headCovering ?? 'none', coverColor,
    kippah: o.kippah ?? 'none', beard: o.beard ?? 'none', glasses: !!o.glasses,
    knit: !female && o.coverColor && safeColor(o.coverColor, '') ? { c: coverColor, ring: knit.ring } : knit,
    shirt,
  };
}

const box = (viewBox: string): [number, number, number, number] => { const v = viewBox.split(' ').map(Number); return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 100, v[3] ?? 100]; };
const ROOT = (viewBox: string, inner: string) => {
  const [, , w, h] = box(viewBox);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${viewBox}">${inner}</svg>`;
};
const fade = (markup: string, deceased: boolean, dark = false) => deceased ? `<g opacity="${dark ? '0.8' : '0.62'}">${ash(markup, dark)}</g>` : markup;

/** The corner badge: the lit candle for the deceased, else the rose heart for the ill (never both: ill is for the living). */
function badgeFor(style: 'A' | 'B', viewBox: string, dark: boolean, kind: 'candle' | 'heal' = 'candle'): string {
  const draw = kind === 'candle' ? candleBadge : healBadge;
  if (style === 'B') return draw(75, 75, 11, dark); // inside the disc: the round clip is done by the Figure wrapper
  const [x, y, w, h] = box(viewBox);
  const r = Math.max(10, Math.min(w, h) * 0.17);
  return draw(x + w * 0.74, y + h - r - 2, r, dark);
}
const badgeOf = (style: 'A' | 'B', viewBox: string, dark: boolean, gone: boolean, ill: boolean) => gone ? badgeFor(style, viewBox, dark) : ill ? badgeFor(style, viewBox, dark, 'heal') : '';

function figureBMarkup(m: Member) {
  const l = lookOf(m), hd = head(l);
  return hd.back + bodyB(l) + hd.face;
}

export function figureSvg(a: FigureArgs): string {
  const m = { stage: a.stage, gender: a.gender, options: a.options, seed: a.seed };
  const disc = a.dark ? DISC.dark : DISC.light;
  if (a.style === 'B') {
    // No clipPath (weak on iOS): the disc is a plain circle and Figure.tsx rounds the image with a clipping wrapper.
    const art = `<circle cx="50" cy="50" r="50" fill="${disc}"/>${figureBMarkup(m)}`;
    return ROOT('0 0 100 100', `${fade(art, a.deceased, a.dark)}${badgeOf('B', '0 0 100 100', a.dark, a.deceased, !!a.ill)}`);
  }
  const fig = figureA(lookOf(m));
  return ROOT(fig.viewBox, `${fade(fig.markup, a.deceased, a.dark)}${badgeOf('A', fig.viewBox, a.dark, a.deceased, !!a.ill)}`);
}

/** A married child: one tile, our child in front on a tekhelet stage, the spouse a step behind (and a little smaller). */
export function coupleSvg(a: { style: 'A' | 'B'; dark: boolean; child: Member; spouse: Member }): string {
  const spot = a.dark ? SPOT.dark : SPOT.light;
  const gone = !!a.child.deceased || !!a.spouse.deceased;
  if (a.style === 'B') {
    const art = `<circle cx="50" cy="50" r="50" fill="${a.dark ? DISC.dark : DISC.light}"/>`
      + fade(`<g transform="translate(35 56.2) scale(0.6615) translate(-50 -46)">${figureBMarkup(a.spouse)}</g>`, !!a.spouse.deceased, a.dark)
      + `<ellipse data-marker="1" cx="62" cy="100" rx="30" ry="9" fill="${spot.c}" fill-opacity="${spot.o}"/>`
      + fade(`<g transform="translate(62 52) scale(0.8) translate(-50 -46)">${figureBMarkup(a.child)}</g>`, !!a.child.deceased, a.dark);
    return ROOT('0 0 100 100', `${art}${badgeOf('B', '0 0 100 100', a.dark, gone, !!(a.child.ill || a.spouse.ill))}`);
  }
  const vb = '18 0 70 150';
  const art = `<ellipse data-marker="1" cx="61" cy="145.5" rx="17" ry="3.6" fill="${spot.c}" fill-opacity="${spot.o}"/>`
    + fade(`<g transform="translate(-11 0) translate(50 146) scale(0.9) translate(-50 -146)">${figureA(lookOf(a.spouse)).markup}</g>`, !!a.spouse.deceased, a.dark)
    + fade(`<g transform="translate(11 0)">${figureA(lookOf(a.child)).markup}</g>`, !!a.child.deceased, a.dark)
    + `<rect data-marker="1" x="55" y="147" width="30" height="3" rx="1.5" fill="${spot.c}"/>`;
  return ROOT(vb, `${art}${badgeOf('A', vb, a.dark, gone, !!(a.child.ill || a.spouse.ill))}`);
}

/** An empty slot: a dashed outline (head and shoulders in a dashed circle in B, the body in A). */
export function ghostSvg(style: 'A' | 'B', dark: boolean): string {
  const g = ghost(style);
  return ROOT(g.viewBox, g.inner.replace(/currentColor/g, dark ? MUTED.dark : MUTED.light));
}

/** The width / height of a figure's drawing, to size the image without distortion. */
export function aspectOf(svg: string): number {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  return m ? Number(m[1]) / Number(m[2]) : 1;
}
export { frameOf };
