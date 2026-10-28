import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultFigure, figureSvg, resolveFigure, stageOf, coupleSvg, ghostSvg } from '../src/tree/figures/figure.ts';
import type { AgeStage } from '../src/tree/figures/figure.ts';
import { fromGregorian } from '../src/tree/dates.ts';
import type { FigureOptions, HebDate } from '../src/tree/types.ts';

const TODAY = '2026-10-28';
const dayShift = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
// Hebrew birth date whose `years`-th birthday was `daysAgo` days ago (negative: the birthday is still ahead).
const born = (years: number, daysAgo = 0): HebDate => { const d = fromGregorian(dayShift(TODAY, -daysAgo)); return { ...d, year: (d.year ?? 0) - years }; };

const STAGES: AgeStage[] = ['baby', 'toddler', 'child', 'preteen', 'teen', 'youngAdult', 'adult', 'older'];

test('stageOf: children by age, boys', () => {
  const s = (y: number) => stageOf(born(y, 3), 'child', TODAY, 'm');
  assert.equal(s(0), 'baby');
  assert.equal(s(1), 'toddler'); assert.equal(s(3), 'toddler');
  assert.equal(s(4), 'child'); assert.equal(s(8), 'child');
  assert.equal(s(9), 'preteen'); assert.equal(s(12), 'preteen');
  assert.equal(s(13), 'teen'); assert.equal(s(17), 'teen');
  assert.equal(s(18), 'youngAdult'); assert.equal(s(30), 'youngAdult');
});

test('stageOf: girls become נערה at 12 (bat mitzvah)', () => {
  const s = (y: number) => stageOf(born(y, 3), 'child', TODAY, 'f');
  assert.equal(s(11), 'preteen');
  assert.equal(s(12), 'teen');
  assert.equal(s(17), 'teen');
  assert.equal(s(18), 'youngAdult');
});

test('stageOf: the birthday itself starts the next stage, the day before does not', () => {
  assert.equal(stageOf(born(12, 0), 'child', TODAY, 'f'), 'teen');
  assert.equal(stageOf(born(12, -1), 'child', TODAY, 'f'), 'preteen'); // birthday is tomorrow
  assert.equal(stageOf(born(13, 0), 'grandchild', TODAY, 'm'), 'teen');
  assert.equal(stageOf(born(13, -1), 'grandchild', TODAY, 'm'), 'preteen');
});

test('stageOf: no birth date = child 4-8; generations without a date', () => {
  assert.equal(stageOf(undefined, 'child', TODAY, 'm'), 'child');
  assert.equal(stageOf(undefined, 'grandchild', TODAY, 'f'), 'child');
  for (const r of ['father', 'mother'] as const) assert.equal(stageOf(undefined, r, TODAY, 'm'), 'older');
  for (const r of ['self', 'spouse', 'childSpouse', 'formerSpouse'] as const) assert.equal(stageOf(undefined, r, TODAY, 'f'), 'adult');
});

test('stageOf: parents and spouses ignore the birth date', () => {
  assert.equal(stageOf(born(70), 'father', TODAY, 'm'), 'older');
  assert.equal(stageOf(born(35), 'self', TODAY, 'm'), 'adult');
});

test('defaults per generation (owner decisions)', () => {
  const grandma = defaultFigure('mother', 'f', 'older');
  assert.equal(grandma.headCovering, 'hat');
  assert.equal(grandma.glasses, true);
  const us = defaultFigure('spouse', 'f', 'adult');
  assert.equal(us.headCovering, 'tichel');
  assert.equal(defaultFigure('self', 'f', 'adult').headCovering, 'tichel');
  assert.equal(defaultFigure('childSpouse', 'f', 'adult').headCovering, 'tichel');
  for (const [r, st] of [['father', 'older'], ['self', 'adult'], ['spouse', 'adult'], ['childSpouse', 'adult'], ['child', 'teen']] as const) {
    assert.equal(defaultFigure(r, 'm', st).kippah, 'knitted', `${r} wears a large knitted kippah`);
  }
  assert.equal(defaultFigure('self', 'm', 'adult').beard, 'short');
  assert.equal(defaultFigure('child', 'f', 'teen').headCovering, 'none');
  assert.equal(defaultFigure('grandchild', 'f', 'child').headCovering, 'none');
});

test('resolveFigure: a person\'s own choice wins over the default, the rest follows the default', () => {
  const r = resolveFigure('spouse', 'f', 'adult', { headCovering: 'wig', skin: 2 });
  assert.equal(r.headCovering, 'wig'); assert.equal(r.skin, 2);
  assert.equal(r.glasses, false);
  const m = resolveFigure('self', 'm', 'adult', { kippah: 'none' });
  assert.equal(m.kippah, 'none'); assert.equal(m.beard, 'short');
});

const NO_EXTERNAL = (svg: string) => {
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'root has the svg namespace only');
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(!/href\s*=\s*["']?\s*(https?:|\/\/|data:|file:)/i.test(svg), 'no external href');
  assert.ok(!/<script/i.test(svg) && !/\son\w+\s*=/i.test(svg) && !/<foreignObject/i.test(svg) && !/<image\b/i.test(svg) && !/url\(\s*["']?(https?:|\/\/)/i.test(svg));
  assert.ok(!/var\(--/.test(svg), 'no CSS variables: an SVG shown as an image cannot see them');
  assert.ok(!/<style/i.test(svg));
  assert.ok(!/<(clipPath|mask|filter)\b|clip-path=|mask=|filter=/i.test(svg), 'no clipPath/mask/filter: iOS SVG renderers are weak with them');
};
// Well-formed: tags balance and attributes are quoted (a tiny XML check, no dependency).
function wellFormed(svg: string) {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    assert.equal(svg.slice(last, m.index).trim(), '', 'no stray text between tags');
    last = re.lastIndex;
    if (m[1]) assert.equal(stack.pop(), m[2], `closing ${m[2]}`);
    else if (!m[4]) stack.push(m[2] ?? '');
  }
  assert.equal(last, svg.length); assert.deepEqual(stack, []);
  assert.ok(!/NaN|undefined|null/.test(svg), 'no NaN / undefined leaked into the markup');
}

test('every stage, gender, style, mode renders a well-formed SVG without external references', () => {
  for (const style of ['A', 'B'] as const) for (const stage of STAGES) for (const gender of ['m', 'f'] as const) for (const dark of [false, true]) for (const deceased of [false, true]) {
    const svg = figureSvg({ style, stage, gender, options: resolveFigure('child', gender, stage), deceased, dark });
    NO_EXTERNAL(svg); wellFormed(svg);
    assert.match(svg, /viewBox="[-\d. ]+"/);
  }
});

test('every option value yields a well-formed SVG', () => {
  const opts: FigureOptions[] = [];
  for (const headCovering of ['tichel', 'hat', 'wig', 'none'] as const) for (const coverColor of [undefined, '#D0655A', '#5C7FC9']) for (const glasses of [false, true]) opts.push({ headCovering, coverColor, glasses });
  for (const kippah of ['knitted', 'small', 'velvet', 'none'] as const) for (const beard of ['none', 'short', 'full'] as const) for (const skin of [0, 1, 2] as const) for (const hair of [undefined, '#2B2320', '#A9AEBB']) opts.push({ kippah, beard, skin, hair });
  for (const o of opts) for (const style of ['A', 'B'] as const) for (const [stage, gender] of [['adult', 'm'], ['adult', 'f'], ['older', 'm'], ['older', 'f'], ['teen', 'f'], ['child', 'm']] as const) {
    const svg = figureSvg({ style, stage, gender, options: o, deceased: false, dark: false });
    NO_EXTERNAL(svg); wellFormed(svg);
  }
});

test('hostile option strings cannot inject markup', () => {
  const svg = figureSvg({ style: 'B', stage: 'adult', gender: 'f', options: { coverColor: '"/><script>alert(1)</script>', hair: 'red;" onload="x' } as FigureOptions, deceased: false, dark: false });
  NO_EXTERNAL(svg); wellFormed(svg);
});

test('options change the drawing', () => {
  const draw = (options: FigureOptions, gender: 'm' | 'f' = 'm', stage: AgeStage = 'adult') => figureSvg({ style: 'B', stage, gender, options, deceased: false, dark: false });
  assert.notEqual(draw({ kippah: 'knitted' }), draw({ kippah: 'none' }));
  assert.notEqual(draw({ kippah: 'knitted' }), draw({ kippah: 'velvet' }));
  assert.notEqual(draw({ kippah: 'knitted' }), draw({ kippah: 'small' }));
  assert.notEqual(draw({ beard: 'none' }), draw({ beard: 'full' }));
  assert.notEqual(draw({ glasses: false }), draw({ glasses: true }));
  assert.notEqual(draw({ skin: 0 }), draw({ skin: 2 }));
  assert.notEqual(draw({ headCovering: 'tichel' }, 'f'), draw({ headCovering: 'wig' }, 'f'));
  assert.notEqual(draw({ headCovering: 'hat' }, 'f'), draw({ headCovering: 'none' }, 'f'));
  assert.notEqual(draw({ headCovering: 'tichel', coverColor: '#2F8F8A' }, 'f'), draw({ headCovering: 'tichel', coverColor: '#D0655A' }, 'f'));
});

test('deceased: ash colours, 62% opacity, a candle badge; the ז״ל label stays outside the SVG', () => {
  const base = { style: 'B' as const, stage: 'older' as const, gender: 'm' as const, options: defaultFigure('father', 'm', 'older'), dark: false };
  const alive = figureSvg({ ...base, deceased: false }), gone = figureSvg({ ...base, deceased: true });
  assert.notEqual(alive, gone);
  assert.ok(!alive.includes('data-candle')); assert.ok(gone.includes('data-candle'));
  assert.ok(gone.includes(`opacity="0.62"`));
  assert.ok(!gone.includes('ז״ל') && !alive.includes('ז״ל') && !/<text/i.test(gone));
  // no saturated colour is left in the figure group (every art colour is grey): only the candle flame is gold.
  const art = gone.slice(0, gone.indexOf('data-candle'));
  for (const hex of art.match(/#[0-9a-fA-F]{6}/g) ?? []) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]; assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 2, `${hex} is grey`); }
  for (const style of ['A', 'B'] as const) assert.ok(figureSvg({ ...base, style, deceased: true }).includes('data-candle'));
});

test('dark mode only changes the disc and the badge, not the art', () => {
  const base = { style: 'B' as const, stage: 'adult' as const, gender: 'f' as const, options: defaultFigure('spouse', 'f', 'adult'), deceased: false };
  const l = figureSvg({ ...base, dark: false }), d = figureSvg({ ...base, dark: true });
  assert.notEqual(l, d);
  assert.ok(l.includes('#EAEDE2') && d.includes('#283058'));
  assert.ok(!d.includes('#EAEDE2'));
});

test('couple tile: our child in front with the tekhelet marker, spouse behind', () => {
  for (const style of ['A', 'B'] as const) for (const dark of [false, true]) for (const deceased of [false, true]) {
    const svg = coupleSvg({ style, dark, child: { stage: 'youngAdult', gender: 'm', options: resolveFigure('child', 'm', 'youngAdult'), deceased }, spouse: { stage: 'adult', gender: 'f', options: resolveFigure('childSpouse', 'f', 'adult') } });
    NO_EXTERNAL(svg); wellFormed(svg);
    assert.ok(svg.includes('data-marker'), 'tekhelet stage marker');
    assert.equal(svg.includes('data-candle'), deceased);
  }
});

test('couple tile: only the deceased person is ashed, the living one keeps colour', () => {
  const child = { stage: 'youngAdult' as const, gender: 'm' as const, options: resolveFigure('child', 'm', 'youngAdult') };
  const spouse = { stage: 'adult' as const, gender: 'f' as const, options: resolveFigure('childSpouse', 'f', 'adult') };
  for (const style of ['A', 'B'] as const) {
    const living = coupleSvg({ style, dark: false, child, spouse });
    const spouseGone = coupleSvg({ style, dark: false, child, spouse: { ...spouse, deceased: true } });
    const childGone = coupleSvg({ style, dark: false, child: { ...child, deceased: true }, spouse });
    assert.ok(!living.includes('opacity="0.62"'));
    for (const svg of [spouseGone, childGone]) { assert.equal(svg.split('opacity="0.62"').length - 1, 1, 'one ashed group'); assert.ok(svg.includes('data-candle')); }
    assert.notEqual(spouseGone, childGone);
    // the tekhelet colour of the living one's clothes survives in both
    assert.ok(spouseGone.includes('#2A3F94') && childGone.includes('#DD7C92'));
  }
});

test('empty slot (ghost) in both styles', () => {
  for (const style of ['A', 'B'] as const) for (const dark of [false, true]) { const svg = ghostSvg(style, dark); NO_EXTERNAL(svg); wellFormed(svg); }
});

test('the same input draws the same string (deterministic, ids included)', () => {
  const o = { style: 'B' as const, stage: 'adult' as const, gender: 'm' as const, options: defaultFigure('self', 'm', 'adult'), deceased: false, dark: false };
  assert.equal(figureSvg(o), figureSvg(o));
});
