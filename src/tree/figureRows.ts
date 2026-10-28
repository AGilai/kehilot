import { stageOf } from './figures/figure.ts';
import type { AgeStage } from './figures/figure.ts';
import type { Person } from './types.ts';

export type Rows = 'covering' | 'cover' | 'kippah' | 'beard' | 'skin' | 'hair' | 'glasses';
export const isoToday = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
export const YOUNG: AgeStage[] = ['baby', 'toddler', 'child', 'preteen', 'teen'];

/** At most five rows (§17.13 P35): women head covering (+ its colour), skin, hair, glasses; men kippah, beard, skin, hair, glasses;
 *  children skin, hair, glasses (the figure grows by itself). */
export function rowsFor(person: Pick<Person, 'gender' | 'relation' | 'birth'>, today = isoToday()): Rows[] {
  const stage = stageOf(person.birth, person.relation, today, person.gender);
  if (YOUNG.includes(stage)) return ['skin', 'hair', 'glasses'];
  return person.gender === 'f' ? ['covering', 'cover', 'skin', 'hair', 'glasses'] : ['kippah', 'beard', 'skin', 'hair', 'glasses'];
}
