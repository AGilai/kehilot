import type { MonthKey, Person } from './types.ts';

// Fixture-mode family trees (screenshots and demos only). Invented names.
const ME = '01FIXTUREUSER00000000001';
const bday = (year: number, month: MonthKey = 'sivan') => ({ day: 12, month, year });

const core = (): Person[] => [
  { id: 'me', userId: ME, relation: 'self', gender: 'f', hebrewFirst: 'דנה', surname: 'בדיוני', fatherName: 'משה', motherName: 'רות', birth: bday(5750) },
  { id: 'sp', userId: '01FIXTUREUSER00000000005', relation: 'spouse', of: 'me', gender: 'm', hebrewFirst: 'יוסי', surname: 'בדיוני', fatherName: 'אברהם', motherName: 'שרה', tribe: 'yisrael', birth: bday(5748) },
  { id: 'mf', relation: 'father', of: 'me', gender: 'm', hebrewFirst: 'משה', tribe: 'yisrael', deceased: true, fatherName: 'יצחק', motherName: 'רבקה', birth: bday(5715) },
  { id: 'mm', relation: 'mother', of: 'me', gender: 'f', hebrewFirst: 'רות', birth: bday(5718) },
  { id: 'sf', relation: 'father', of: 'sp', gender: 'm', hebrewFirst: 'אברהם', tribe: 'yisrael', deceased: true, fatherName: 'דוד', motherName: 'לאה', birth: bday(5712) },
  { id: 'sm', relation: 'mother', of: 'sp', gender: 'f', hebrewFirst: 'שרה', ill: true, birth: bday(5716) },
  { id: 'mff', relation: 'father', of: 'mf', gender: 'm', hebrewFirst: 'יצחק', deceased: true },
  { id: 'mfm', relation: 'mother', of: 'mf', gender: 'f', hebrewFirst: 'רבקה', deceased: true },
];
const kid = (id: string, first: string, gender: 'm' | 'f', year: number): Person => ({ id, relation: 'child', gender, hebrewFirst: first, birth: bday(year, 'tishrei') });

/** Seven children, the first married (her husband has no tribe yet: a gold dot); four generations up on one side. */
export const treeSeven = (): Person[] => [...core(),
  kid('c1', 'נועה', 'f', 5775), { id: 'c1s', relation: 'childSpouse', of: 'c1', gender: 'm', hebrewFirst: 'אליהו' },
  kid('c2', 'אליעזר', 'm', 5777), kid('c3', 'שירה', 'f', 5779), kid('c4', 'אורי', 'm', 5781), kid('c5', 'תמר', 'f', 5783), kid('c6', 'בנימין', 'm', 5785), { ...kid('c7', 'הדס', 'f', 5786), hebrewFirst: '' },
  { id: 'g1', relation: 'grandchild', of: 'c1', gender: 'f', hebrewFirst: 'מיכל' },
];
/** Five children, four of them married: fits one phone screen. */
export const treeFiveMarried = (): Person[] => [...core(),
  ...[['c1', 'נועה', 'f', 'אליהו'], ['c2', 'אליעזר', 'm', 'רבקה'], ['c3', 'שירה', 'f', 'דניאל'], ['c4', 'אורי', 'm', 'מיכל']].flatMap(([id, first, gender, spouse], i) => [
    { ...kid(id!, first!, gender as 'm' | 'f', 5770 + i * 2), tribe: gender === 'm' ? 'yisrael' as const : undefined },
    { id: `${id}s`, relation: 'childSpouse' as const, of: id!, gender: gender === 'm' ? 'f' as const : 'm' as const, hebrewFirst: spouse!, tribe: gender === 'm' ? undefined : 'levi' as const },
  ]),
  kid('c5', 'תמר', 'f', 5784),
];
/** Only me, name not yet filled. */
export const treeSolo = (): Person[] => [{ id: 'me', userId: ME, relation: 'self', gender: 'f' }];

/** Me with my parents and two children, no partner (the empty spouse place). */
export const treeAlone = (): Person[] => [
  ...core().filter(p => p.id !== 'sp' && p.of !== 'sp'),
  kid('c1', 'נועה', 'f', 5775), kid('c2', 'אליעזר', 'm', 5777),
];

/** The tree to serve for a fixture screen. */
export function fixtureTreeFor(screen: string | null): Person[] {
  switch (screen) {
    case 'tree': case 'tree-admin': case 'me-linked': case 'child-sheet': return treeSeven();
    case 'tree-married': return treeFiveMarried();
    case 'tree-solo': return treeSolo();
    case 'tree-link': case 'tree-link-sent': case 'tree-link-received': case 'tree-link-declined': case 'tree-link-expired': return treeAlone();
    default: return [];
  }
}
