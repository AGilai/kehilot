import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENUM_CHOICES, enumPatch, withOption } from '../src/tree/figureOptions.ts';
import { COVER_COLORS, HAIR } from '../src/tree/figures/parts.ts';
import { resolveFigure } from '../src/tree/figures/figure.ts';
import { rowsFor } from '../src/tree/figureRows.ts';
import type { FigureOptions } from '../src/tree/types.ts';

// Mirror of server/cloud/tree_rules.py _figure.
const KEYS = new Set(['headCovering', 'kippah', 'beard', 'coverColor', 'hair', 'glasses', 'skin']);
const ENUMS: Record<string, string[]> = { headCovering: ['tichel', 'hat', 'wig', 'none'], kippah: ['knitted', 'small', 'velvet', 'none'], beard: ['none', 'short', 'full'] };
function serverAccepts(v: FigureOptions): boolean {
  for (const [k, x] of Object.entries(v)) {
    if (!KEYS.has(k)) return false;
    if (ENUMS[k] && !ENUMS[k]!.includes(x as string)) return false;
    if ((k === 'coverColor' || k === 'hair') && !/^#[0-9a-fA-F]{6}$/.test(x as string)) return false;
    if (k === 'glasses' && typeof x !== 'boolean') return false;
    if (k === 'skin' && ![0, 1, 2].includes(x as number)) return false;
  }
  return true;
}

test('every option the picker can write is accepted by the server rules', () => {
  const written: FigureOptions[] = [];
  for (const key of Object.keys(ENUM_CHOICES) as (keyof typeof ENUM_CHOICES)[]) for (const v of ENUM_CHOICES[key]) written.push(withOption(undefined, enumPatch(key, v as never)));
  for (const c of COVER_COLORS) written.push({ coverColor: c });
  for (const h of Object.values(HAIR)) written.push({ hair: h });
  for (const skin of [0, 1, 2] as const) written.push({ skin });
  written.push({ glasses: true }, { glasses: false });
  for (const w of written) assert.ok(serverAccepts(w), JSON.stringify(w));
});

test('a head covering choice writes headCovering, is shown, and changes the resolved figure', () => {
  const own = withOption(undefined, enumPatch('headCovering', 'wig'));
  assert.deepEqual(own, { headCovering: 'wig' });
  assert.equal(resolveFigure('self', 'f', 'adult', own).headCovering, 'wig');
  assert.notEqual(resolveFigure('self', 'f', 'adult', own).headCovering, resolveFigure('self', 'f', 'adult', undefined).headCovering);
  assert.equal(resolveFigure('self', 'm', 'adult', withOption(undefined, enumPatch('kippah', 'velvet'))).kippah, 'velvet');
});

test('rows: women covering + colour, men kippah + beard, children skin/hair/glasses, at most five', () => {
  assert.deepEqual(rowsFor({ gender: 'f', relation: 'self' }, '2026-10-28'), ['covering', 'cover', 'skin', 'hair', 'glasses']);
  assert.deepEqual(rowsFor({ gender: 'm', relation: 'father' }, '2026-10-28'), ['kippah', 'beard', 'skin', 'hair', 'glasses']);
  assert.deepEqual(rowsFor({ gender: 'f', relation: 'child' }, '2026-10-28'), ['skin', 'hair', 'glasses']);
});
