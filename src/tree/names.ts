import { fatherNameOf, motherNameOf, tribeOf } from './relations.ts';
import type { Person, PersonName } from './types.ts';

// Names are always read from the tree (the parent's figure), never copied onto the child. Parts that are missing are
// left out of `text` and listed in `missing`; the sheet draws the blank.
function build(tree: Person[], id: string, parent: 'father' | 'mother', tribeSuffix: boolean): PersonName {
  const person = tree.find(p => p.id === id);
  if (!person) return { text: '', missing: ['first'] };
  const first = person.hebrewFirst?.trim();
  const parentName = parent === 'father' ? fatherNameOf(tree, id) : motherNameOf(tree, id);
  const missing: PersonName['missing'] = [];
  if (!first) missing.push('first');
  if (!parentName) missing.push(parent);
  const tribe = tribeSuffix ? tribeOf(tree, id) : undefined;
  const suffix = tribe === 'kohen' ? ' הכהן' : tribe === 'levi' ? ' הלוי' : '';
  const text = !first ? '' : !parentName ? first : `${first} ${person.gender === 'm' ? 'בן' : 'בת'} ${parentName}${suffix}`;
  return { text, missing };
}
export const aliyahName = (tree: Person[], id: string) => build(tree, id, 'father', true);
export const prayerName = (tree: Person[], id: string) => build(tree, id, 'mother', false);
export function memorialName(tree: Person[], id: string): PersonName {
  const name = aliyahName(tree, id);
  return { ...name, text: name.text ? `${name.text} ז״ל` : '' };
}
