import { normalize, queryWords } from '../search/normalize.ts';
import type { PhoneListFamily } from './types.ts';

/** Every query word must occur in the family name or in a person's name. Empty query: everything. */
export function filterFamilies(rows: PhoneListFamily[], q: string): PhoneListFamily[] {
  const words = queryWords(q);
  if (words.length === 0) return rows;
  return rows.filter(f => {
    const hay = normalize([f.name, ...f.people.map(p => p.name)].join(' '));
    return words.every(w => hay.includes(w));
  });
}

const collator = new Intl.Collator('he');
export const sortFamilies = (rows: PhoneListFamily[]): PhoneListFamily[] => [...rows].sort((a, b) => collator.compare(a.name, b.name));
