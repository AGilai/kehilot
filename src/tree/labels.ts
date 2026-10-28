import { missingParts } from './layout.ts';
import type { FamilyStatus } from './layout.ts';
import type { Person } from './types.ts';

// Words for the tree screen, built from a translate function (the screen passes i18n's `t`).
export type T = (key: string, params?: Record<string, string | number>) => string;

const find = (tree: Person[], id?: string) => (id ? tree.find(p => p.id === id) : undefined);
const first = (p?: Person) => p?.hebrewFirst?.trim() ?? '';

/** The word for an empty place or a figure without a name: אבא, אמא, בן זוג, … */
export function roleWord(p: { relation: string; gender: 'm' | 'f' }, t: T): string {
  switch (p.relation) {
    case 'self': return t('tree.role.self');
    case 'father': return t('tree.role.father');
    case 'mother': return t('tree.role.mother');
    case 'spouse': case 'childSpouse': case 'formerSpouse': return t(p.gender === 'm' ? 'tree.role.spouseM' : 'tree.role.spouseF');
    case 'child': return t(p.gender === 'm' ? 'tree.role.son' : 'tree.role.daughter');
    default: return t('tree.role.grandchild');
  }
}
/** The first name shown under a figure, or the role word when there is none. */
export const nameOrRole = (p: { relation: string; gender: 'm' | 'f'; hebrewFirst?: string }, t: T): string => p.hebrewFirst?.trim() || roleWord(p, t);

/** "נועה ואליהו" for a married child's tile. */
export const pairName = (a: Person, b: Person, t: T) => t('tree.pair', { a: nameOrRole(a, t), b: nameOrRole(b, t) });

/** The title of the couple card: "יוסף ומרים ישראלי", one person: "יוסף ישראלי". Blank names are left out. */
export function coupleLabel(people: Person[], t: T): string {
  const names = people.map(first).filter(Boolean);
  const surname = people.map(p => p.surname?.trim() ?? '').find(Boolean) ?? '';
  if (names.length === 2) return t('tree.coupleName', { a: names[0]!, b: names[1]!, surname }).trim();
  if (names.length === 1) return `${names[0]} ${surname}`.trim();
  return surname || t('me.family.title');
}

/** How this figure relates to the tree: "אבא של יוסף", "הבת שלנו", "בעלה של דנה". */
export function relationLabel(tree: Person[], p: Person, t: T): string {
  const of = find(tree, p.of);
  const ofName = of && first(of);
  switch (p.relation) {
    case 'self': return t('tree.rel.self');
    case 'spouse': return of && ofName ? t(p.gender === 'm' ? 'tree.rel.husband' : 'tree.rel.wife', { name: ofName }) : roleWord(p, t);
    case 'father': case 'mother':
      if (ofName) return t(p.relation === 'father' ? 'tree.rel.father' : 'tree.rel.mother', { name: ofName });
      return of?.relation === 'self' || of?.relation === 'spouse' ? t('tree.rel.ofMe', { kind: roleWord(p, t) }) : roleWord(p, t);
    case 'child': return t(p.gender === 'm' ? 'tree.rel.son' : 'tree.rel.daughter');
    case 'childSpouse': return ofName ? t('tree.rel.spouseOf', { name: ofName }) : roleWord(p, t);
    case 'grandchild': return t('tree.rel.grandchild');
    default: return t('tree.rel.formerSpouse');
  }
}

/** The state in words: "נפטר/ה", "עוד לא מולא", "חסר שם האם". Empty when there is nothing to say. */
export function stateWords(tree: Person[], p: Person, t: T): string[] {
  const out: string[] = [];
  if (p.deceased) out.push(t('tree.state.deceased'));
  const miss = missingParts(tree, p);
  if (miss.length === 0) return out;
  const nothing = !first(p) && !p.fatherName && !p.motherName && !p.tribe && !p.birth && !tree.some(x => x.of === p.id && (x.relation === 'father' || x.relation === 'mother'));
  if (nothing) { out.push(t('tree.state.unfilled')); return out; }
  const word = { first: 'missFirst', father: 'missFather', mother: 'missMother', tribe: 'missTribe' } as const;
  out.push(miss.length === 1 ? t(`tree.state.${word[miss[0]!]}`) : t('tree.state.missMany', { list: miss.map(m => t(`tree.part.${m}`)).join(', ') }));
  return out;
}

/** The screen reader label of a tile: "אבא של יוסף: אברהם ז״ל, נפטר/ה. פתיחת הפרטים". */
export function figureLabel(parts: { relation: string; name: string; deceased?: boolean; states: string[] }, t: T): string {
  const name = parts.deceased ? `${parts.name} ${t('tree.zl')}` : parts.name;
  return `${parts.relation}: ${[name, ...parts.states].join(', ')}. ${t('tree.open')}`;
}

/** The Me row's one status line (§18.2) and its mark: a coloured dot and bold text for what needs the person's attention. */
export function statusLine(s: FamilyStatus, t: T): { text: string; tone: 'request' | 'missing' | 'muted' } {
  switch (s.kind) {
    case 'request': return { text: t('me.family.request', { name: s.name }), tone: 'request' };
    case 'missing': return { text: t('me.family.missing', { n: s.n }), tone: 'missing' };
    case 'empty': return { text: t('me.family.empty'), tone: 'muted' };
    case 'sent': return { text: t('me.family.sent', { name: s.name }), tone: 'muted' };
    case 'complete': return { text: s.date ? t('me.family.updated', { date: s.date }) : t('me.family.complete'), tone: 'muted' };
  }
}
