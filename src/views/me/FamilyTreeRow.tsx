import React from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import type { FamilyView } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { ForwardIcon, Icon } from '../../kit/Icon.tsx';
import { statusLine } from '../../tree/labels.ts';
import { familyStatus } from '../../tree/layout.ts';
import type { Person } from '../../tree/types.ts';

/** §18.2 "המשפחה שלי": one row (72 high, tree icon) with ONE status line; opens the family tree. Members and gabbaim only. */
export function FamilyTreeRow({ view, kehilaId, onOpen }: { view: FamilyView; kehilaId: string; onOpen: () => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  const [people, setPeople] = React.useState<Person[] | null>(null);
  React.useEffect(() => {
    let live = true;
    api.familyTree(kehilaId).then(d => { if (live) setPeople(d.people); }, () => { if (live) setPeople(null); });
    return () => { live = false; };
  }, [api, kehilaId, view]);
  const request = view.received[0];
  const sent = view.sent?.state === 'pending' ? view.sent : null;
  // No status line until the tree is here: a wrong "not filled in" would be worse than a blank.
  const line = people ? statusLine(familyStatus({ tree: people, request: request ? { name: request.fromName } : null, sent: sent ? { name: sent.toName } : null }), t) : null;
  const color = line?.tone === 'request' ? k.pomegranate : line?.tone === 'missing' ? k.gold : k.muted;
  return (
    <Pressable testID="me-family-row" accessibilityRole="button" accessibilityLabel={`${t('me.family.title')}${line ? `, ${line.text}` : ''}`} onPress={onOpen}
      style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
      <Icon name="tree" size={28} color={k.tekhelet} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold>{t('me.family.title')}</Txt>
        {line ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {line.tone !== 'muted' ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /> : null}
            <Txt size="small" bold={line.tone !== 'muted'} color={color} style={{ flexShrink: 1 }}>{line.text}</Txt>
          </View>
        ) : null}
      </View>
      <ForwardIcon color={k.muted} />
    </Pressable>
  );
}
