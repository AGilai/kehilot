import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { nameOrRole, roleWord } from '../../tree/labels.ts';
import type { Slot } from '../../tree/layout.ts';
import type { Person } from '../../tree/types.ts';
import { TreeScreen, useWide } from './TreeScreen.tsx';

type Picked = { person: Person } | { slot: Slot } | null;

/**
 * The tree screen with its (TEMPORARY) detail view: a bare sheet, or the side panel when wide, that only shows the figure's
 * name. Task 5 replaces `Placeholder` with the real person sheet and panel; nothing else here needs to change.
 */
export function TreeRoute({ onBack, readOnly, familyId, familyName }: { onBack: () => void; readOnly?: boolean; familyId?: string; familyName?: string }) {
  const { t } = useI18n();
  const wide = useWide();
  const peopleRef = React.useRef<Person[]>([]);
  const [picked, setPicked] = React.useState<Picked>(null);
  const title = !picked ? '' : 'person' in picked ? nameOrRole(picked.person, t) : roleWord({ relation: picked.slot.relation, gender: picked.slot.gender }, t);
  const body = picked ? <Placeholder title={title} /> : <Placeholder title="" hint />;
  return (
    <>
      <TreeScreen onBack={onBack} readOnly={readOnly} familyId={familyId} familyName={familyName}
        selectedId={picked && 'person' in picked ? picked.person.id : null}
        onOpenPerson={id => { const p = peopleRef.current.find(x => x.id === id); if (p) setPicked({ person: p }); }}
        onOpenSlot={slot => setPicked({ slot })}
        onPeople={p => { peopleRef.current = p; }}
        panel={wide ? body : undefined} />
      {!wide ? <Sheet visible={!!picked} title={title} onClose={() => setPicked(null)}>{body}</Sheet> : null}
    </>
  );
}

function Placeholder({ title, hint }: { title: string; hint?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <View style={{ padding: 16, gap: 8 }}>
      {title && !hint ? <Txt serif size="title" content>{title}</Txt> : null}
      <Txt color={k.muted}>{hint ? t('tree.legend.tap') : t('tree.soon')}</Txt>
    </View>
  );
}
