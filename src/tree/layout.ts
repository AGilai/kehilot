import { MAX_GENERATIONS_UP, fatherNameOf, motherNameOf, tribeOf } from './relations.ts';
import type { Person } from './types.ts';

// Pure layout of the family-tree screen (UX-DESIGN §17.2): which figures fill which row, for one "centre" couple.
// The centre is a figure id: the root (self or spouse) is our couple; a father/mother figure is the couple of that
// person's parents (one level up per step). Grandchildren are never in the grid; a married child is one tile.

/** An empty place in the tree: tapping it opens the person sheet empty, and saving creates this figure. */
export type Slot = { relation: 'self' | 'spouse' | 'father' | 'mother' | 'child'; of?: string; gender: 'm' | 'f' };
export type Spot = { person: Person; slot?: undefined } | { person?: undefined; slot: Slot };
export type ParentCard = { ofId: string; father: Spot; mother: Spot; /** The figure that becomes the centre when "their parents" is pressed; null when there is none or the 6th generation is reached. */ upId: string | null };
export type ChildTile = { person: Person; partner?: Person };
export type TreeLayout = {
  /** True when the centre is our own couple. */
  root: boolean;
  hasSelf: boolean;
  /** Parent cards above the couple: one per adult of the centre couple that has a figure (husband's first). */
  parents: ParentCard[];
  /** The centre couple, husband first (right in RTL). */
  couple: Spot[];
  /** The children grid. Above the root only the one child we came from. */
  children: ChildTile[];
  /** The tile the user came from (level above the root), shown with a ring; null at the root. */
  from: ChildTile | null;
  /** Persons whose parents were opened on the way up: root first. Empty at the root. */
  trail: Person[];
  /** Room for a "+ ילד/ה" tile (root only, under 20 children). */
  canAddChild: boolean;
};

const find = (tree: Person[], id: string) => tree.find(p => p.id === id);
const isParentRel = (p: Person) => p.relation === 'father' || p.relation === 'mother';
const selfOf = (tree: Person[]) => tree.find(p => p.relation === 'self');
const spouseOf = (tree: Person[]) => tree.find(p => p.relation === 'spouse');
const MAX_CHILDREN = 20;

/** How many generations above self/spouse a figure is (0 for them). */
function depthOf(tree: Person[], person: Person): number {
  let steps = 0;
  for (let cur: Person | undefined = person; cur && isParentRel(cur) && steps <= MAX_GENERATIONS_UP + 1; steps++) cur = cur.of ? find(tree, cur.of) : undefined;
  return steps;
}
const parentFigure = (tree: Person[], of: string, relation: 'father' | 'mother') => tree.find(p => p.relation === relation && p.of === of);
const spot = (person: Person | undefined, slot: Slot): Spot => (person ? { person } : { slot });

function card(tree: Person[], adult: Person): ParentCard {
  const father = parentFigure(tree, adult.id, 'father');
  const mother = parentFigure(tree, adult.id, 'mother');
  const up = father ?? mother;
  return {
    ofId: adult.id,
    father: spot(father, { relation: 'father', of: adult.id, gender: 'm' }),
    mother: spot(mother, { relation: 'mother', of: adult.id, gender: 'f' }),
    upId: up && depthOf(tree, up) < MAX_GENERATIONS_UP ? up.id : null,
  };
}
/** Husband first; same-gender or unknown: the order given. */
const husbandFirst = <T extends { gender: 'm' | 'f' }>(a: T, b: T): [T, T] => (a.gender === 'f' && b.gender === 'm' ? [b, a] : [a, b]);

/** The partner shown beside a figure: the spouse of self, the other parent figure of the same child, the child's spouse. */
function partnerOf(tree: Person[], p: Person): Person | undefined {
  if (p.relation === 'self') return spouseOf(tree);
  if (p.relation === 'spouse') return selfOf(tree);
  if (p.relation === 'child') return tree.find(x => x.relation === 'childSpouse' && x.of === p.id);
  if (isParentRel(p) && p.of) return tree.find(x => isParentRel(x) && x.of === p.of && x.id !== p.id);
  return undefined;
}
const tileOf = (tree: Person[], p: Person): ChildTile => { const partner = partnerOf(tree, p); return partner ? { person: p, partner } : { person: p }; };

/** A figure id → the centre it stands for: self and spouse are the root; a missing or non-ancestor id falls back to the root. */
export function normaliseCentre(tree: Person[], centreId: string | null | undefined): string | null {
  const self = selfOf(tree);
  const person = centreId ? find(tree, centreId) : undefined;
  return person && isParentRel(person) ? person.id : self?.id ?? null;
}

/** One level down from a centre: an ancestor couple's child level, or the root. */
export function levelDown(tree: Person[], centreId: string | null | undefined): string | null {
  const person = centreId ? find(tree, centreId) : undefined;
  const of = person && isParentRel(person) && person.of ? find(tree, person.of) : undefined;
  return of && isParentRel(of) ? of.id : selfOf(tree)?.id ?? null;
}

export function treeLayout(tree: Person[], centreId: string | null | undefined): TreeLayout {
  const self = selfOf(tree);
  const centre = normaliseCentre(tree, centreId);
  const centrePerson = centre ? find(tree, centre) : undefined;

  if (!centrePerson || !isParentRel(centrePerson)) {
    const spouse = spouseOf(tree);
    const children = tree.filter(p => p.relation === 'child').map(c => tileOf(tree, c));
    const spots: Spot[] = !self ? [{ slot: { relation: 'self', gender: 'm' } }]
      : [{ person: self }, spot(spouse, { relation: 'spouse', of: self.id, gender: self.gender === 'm' ? 'f' : 'm' })];
    const genderOf = (s: Spot) => (s.person ?? s.slot).gender;
    const couple = spots.length === 2 && genderOf(spots[0]!) === 'f' && genderOf(spots[1]!) === 'm' ? [spots[1]!, spots[0]!] : spots;
    const adults = self ? [self, ...(spouse ? [spouse] : [])] : [];
    const ordered = adults.length === 2 ? husbandFirst(adults[0]!, adults[1]!) : adults;
    return {
      root: true, hasSelf: !!self,
      parents: ordered.map(a => card(tree, a)),
      couple, children, from: null, trail: [], canAddChild: children.length < MAX_CHILDREN,
    };
  }

  // An ancestor couple: the two parents of the same person.
  const of = centrePerson.of ? find(tree, centrePerson.of) : undefined;
  const father = of ? parentFigure(tree, of.id, 'father') : undefined;
  const mother = of ? parentFigure(tree, of.id, 'mother') : undefined;
  const couple: Spot[] = [spot(father, { relation: 'father', of: of?.id, gender: 'm' }), spot(mother, { relation: 'mother', of: of?.id, gender: 'f' })];
  const trail: Person[] = [];
  for (let cur: Person | undefined = of; cur && trail.length <= MAX_GENERATIONS_UP + 1; cur = isParentRel(cur) && cur.of ? find(tree, cur.of) : undefined) trail.unshift(cur);
  return {
    root: false, hasSelf: !!self,
    parents: [father, mother].filter((p): p is Person => !!p).map(a => card(tree, a)),
    couple,
    children: of ? [tileOf(tree, of)] : [],
    from: of ? tileOf(tree, of) : null,
    trail, canAddChild: false,
  };
}

// --- what the names still need (the gold dot) ------------------------------------------------------------------

const filledText = (v?: string) => !!v && v.trim() !== '';
export type MissingPart = 'first' | 'father' | 'mother' | 'tribe';
/** What a figure's names still need. Ancestors feed their descendants' names, so a living one needs a first name; a deceased
 *  ancestor is also remembered by name and needs the whole memorial name. Everybody else on the tree needs all of §17.5.
 *  Grandchildren (not on the tree) and a former spouse (names only) need nothing. */
export function missingParts(tree: Person[], p: Person): MissingPart[] {
  if (p.relation === 'grandchild' || p.relation === 'formerSpouse') return [];
  const out: MissingPart[] = [];
  if (!filledText(p.hebrewFirst)) out.push('first');
  if (isParentRel(p) && !p.deceased) return out;
  if (!fatherNameOf(tree, p.id)) out.push('father');
  if (!motherNameOf(tree, p.id)) out.push('mother');
  if (p.gender === 'm' && !tribeOf(tree, p.id)) out.push('tribe');
  return out;
}
/** §17.3: the gold dot. */
export const needsDetails = (tree: Person[], p: Person): boolean => missingParts(tree, p).length > 0;
const onTree = (p: Person) => p.relation !== 'grandchild' && p.relation !== 'formerSpouse';
/** How many figures on the tree (not grandchildren, not a former spouse) have the gold dot. A married child's tile counts once per figure. */
export function missingCount(tree: Person[]): number {
  return tree.filter(p => onTree(p) && needsDetails(tree, p)).length;
}

export type FamilyStatus =
  | { kind: 'request'; name: string }
  | { kind: 'missing'; n: number }
  | { kind: 'empty' }
  | { kind: 'sent'; name: string }
  | { kind: 'complete'; date: string | null };

/** §18.2 Me row, the first state that applies: a partner request waits · figures miss details · nothing filled but me ·
 *  my request is pending · complete (date `d.m` of the last edit, when known). */
export function familyStatus(o: { tree: Person[]; request?: { name: string } | null; sent?: { name: string } | null; updated?: string | null }): FamilyStatus {
  if (o.request) return { kind: 'request', name: o.request.name };
  const n = missingCount(o.tree);
  if (n > 0) return { kind: 'missing', n };
  if (!o.tree.some(p => p.relation !== 'self')) return { kind: 'empty' };
  if (o.sent) return { kind: 'sent', name: o.sent.name };
  return { kind: 'complete', date: o.updated ?? null };
}
