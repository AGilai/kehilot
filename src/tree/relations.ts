import type { Person } from './types.ts';

export const MAX_GENERATIONS_UP = 6;
const find = (tree: Person[], id: string) => tree.find(p => p.id === id);
const parentFigure = (tree: Person[], id: string, relation: 'father' | 'mother') => tree.find(p => p.relation === relation && p.of === id);

// The couple a person descends from: us for a child, the child and the child's spouse for a grandchild.
function couple(tree: Person[], person: Person): Person[] {
  if (person.relation === 'child') return tree.filter(p => p.relation === 'self' || p.relation === 'spouse');
  if (person.relation === 'grandchild' && person.of) return tree.filter(p => p.id === person.of || (p.relation === 'childSpouse' && p.of === person.of));
  return [];
}
function parentOf(tree: Person[], id: string, relation: 'father' | 'mother'): Person | undefined {
  const person = find(tree, id);
  if (!person) return undefined;
  return parentFigure(tree, id, relation) ?? couple(tree, person).find(p => p.gender === (relation === 'father' ? 'm' : 'f'));
}
export const fatherOf = (tree: Person[], id: string) => parentOf(tree, id, 'father');
export const motherOf = (tree: Person[], id: string) => parentOf(tree, id, 'mother');

// Children of a parent: ours for self/spouse, a married child's for the child or the child's spouse.
export function childrenOf(tree: Person[], id: string): Person[] {
  const person = find(tree, id);
  if (!person) return [];
  if (person.relation === 'self' || person.relation === 'spouse') return tree.filter(p => p.relation === 'child');
  if (person.relation === 'child') return tree.filter(p => p.relation === 'grandchild' && p.of === id);
  if (person.relation === 'childSpouse' && person.of) return tree.filter(p => p.relation === 'grandchild' && p.of === person.of);
  return [];
}

// How many generations above self/spouse this figure is (0 for them).
function depth(tree: Person[], person: Person): number {
  let steps = 0;
  for (let current: Person | undefined = person; current && (current.relation === 'father' || current.relation === 'mother') && steps <= MAX_GENERATIONS_UP + 1; steps++) current = current.of ? find(tree, current.of) : undefined;
  return steps;
}
// The figures one generation above, father then mother; none once the person is at the 6th generation.
export function generationUp(tree: Person[], id: string): Person[] {
  const person = find(tree, id);
  if (!person || depth(tree, person) >= MAX_GENERATIONS_UP) return [];
  return [parentFigure(tree, id, 'father'), parentFigure(tree, id, 'mother')].filter((p): p is Person => !!p);
}

const filled = (value?: string) => !!value && value.trim() !== '';
export const fatherNameOf = (tree: Person[], id: string): string | undefined => {
  const name = fatherOf(tree, id)?.hebrewFirst ?? find(tree, id)?.fatherName;
  return filled(name) ? name!.trim() : undefined;
};
export const motherNameOf = (tree: Person[], id: string): string | undefined => {
  const name = motherOf(tree, id)?.hebrewFirst ?? find(tree, id)?.motherName;
  return filled(name) ? name!.trim() : undefined;
};
// A man's tribe: his own, else his father figure's. Women have none.
export function tribeOf(tree: Person[], id: string): Person['tribe'] {
  const person = find(tree, id);
  if (!person || person.gender !== 'm') return undefined;
  return person.tribe ?? fatherOf(tree, id)?.tribe;
}
// §17.5: first name and both parents' names exist (and a tribe for men).
export function isComplete(tree: Person[], id: string): boolean {
  const person = find(tree, id);
  if (!person) return false;
  return filled(person.hebrewFirst) && !!fatherNameOf(tree, id) && !!motherNameOf(tree, id) && (person.gender === 'f' || !!tribeOf(tree, id));
}
