import React from 'react';
import { Pressable, View } from 'react-native';
import { relationLabel, stateWords, nameOrRole, figureLabel } from '../../tree/labels.ts';
import { needsDetails } from '../../tree/layout.ts';
import type { Person } from '../../tree/types.ts';
import { Figure } from '../../tree/Figure.tsx';
import { ForwardIcon } from '../../kit/Icon.tsx';
import { Card, Txt, useTokens } from '../../kit/components.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';


type Group = { key: string; title: string; people: Person[] };

/** The people of the tree by generation (§17.2 list view): you, parents, their parents, earlier ones, children (with
 *  their spouses and grandchildren), and the former spouse. */
export function groupPeople(tree: Person[], t: (k: string) => string): Group[] {
  const byId = new Map(tree.map(p => [p.id, p]));
  const depth = (p: Person): number => { let d = 0; for (let c: Person | undefined = p; c && (c.relation === 'father' || c.relation === 'mother') && d < 20; d++) c = c.of ? byId.get(c.of) : undefined; return d; };
  const ancestors = tree.filter(p => p.relation === 'father' || p.relation === 'mother');
  const kids: Person[] = [];
  for (const c of tree.filter(p => p.relation === 'child')) {
    kids.push(c, ...tree.filter(p => p.relation === 'childSpouse' && p.of === c.id), ...tree.filter(p => p.relation === 'grandchild' && p.of === c.id));
  }
  const groups: Group[] = [
    { key: 'you', title: t('tree.list.you'), people: tree.filter(p => p.relation === 'self' || p.relation === 'spouse').sort((a, b) => (a.relation === 'self' ? -1 : 1) - (b.relation === 'self' ? -1 : 1)) },
    { key: 'parents', title: t('tree.list.parents'), people: ancestors.filter(p => depth(p) === 1) },
    { key: 'grandparents', title: t('tree.list.grandparents'), people: ancestors.filter(p => depth(p) === 2) },
    { key: 'earlier', title: t('tree.list.earlier'), people: ancestors.filter(p => depth(p) >= 3) },
    { key: 'children', title: t('tree.list.children'), people: kids },
    { key: 'former', title: t('tree.list.formerSpouse'), people: tree.filter(p => p.relation === 'formerSpouse') },
  ];
  return groups.filter(g => g.people.length > 0);
}

/** Rows with words (for screen readers and anyone who prefers lists): name (ז״ל), relation · state, "פרטים ‹". */
export function TreeList({ people, myId, onOpenPerson }: { people: Person[]; myId?: string | null; onOpenPerson: (id: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const groups = groupPeople(people, t);
  if (groups.length === 0) return <Card><Txt color={k.muted}>{t('tree.list.empty')}</Txt></Card>;
  return (
    <View style={{ gap: 12 }}>
      {groups.map(g => (
        <View key={g.key} accessibilityRole="summary" style={{ gap: 4 }}>
          <Txt bold color={k.muted} accessibilityRole="header">{g.title}</Txt>
          <View style={{ backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line }}>
            {g.people.map((p, i) => {
              const name = nameOrRole(p, t);
              const rel = relationLabel(people, p, t);
              const states = stateWords(people, p, t);
              const mine = !!myId && p.userId === myId;
              return (
                <Pressable key={p.id} testID={`tree-row-${p.id}`} accessibilityRole="button" accessibilityLabel={figureLabel({ relation: rel, name, deceased: p.deceased, states }, t)} onPress={() => onOpenPerson(p.id)}
                  style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: k.line }}>
                  <Figure person={p} size={44} style="B" />
                  <View style={{ flex: 1 }}>
                    <Txt bold content>{p.deceased ? `${name} ${t('tree.zl')}` : name}{mine ? ` · ${t('tree.me')}` : ''}</Txt>
                    <Txt size="small" color={needsDetails(people, p) ? k.gold : k.muted}>{[rel, ...states].join(' · ')}</Txt>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><Txt size="small" bold color={k.tekhelet}>{t('tree.list.details')}</Txt><ForwardIcon size={16} color={k.tekhelet} /></View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
