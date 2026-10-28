import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { saveTree } from '../../client/tree.ts';
import type { TreeDoc } from '../../client/tree.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Sheet, Toast, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import type { Slot } from '../../tree/layout.ts';
import type { Target } from '../../tree/sheet.ts';
import { useErrorText } from '../auth/Frame.tsx';
import { PersonSheet, makeId, sheetTitle } from './PersonSheet.tsx';
import type { SaveOutcome } from './PersonSheet.tsx';
import { TreeScreen, useWide } from './TreeScreen.tsx';

type Picked = { target: Target; newId: string; key: string } | null;
const open = (target: Target): Picked => { const newId = makeId(); return { target, newId, key: 'id' in target ? target.id : newId }; };

/**
 * The tree screen with the person sheet (bottom sheet, or the 400 px side panel when wide). The sheet writes the whole tree
 * through `saveTree`; a 409 reloads the newer tree and says so. `readOnly` is the gabbai's view: the sheet shows the values only.
 */
export function TreeRoute({ onBack, readOnly, familyId, familyName, onOpenMe }: { onBack: () => void; readOnly?: boolean; familyId?: string; familyName?: string; onOpenMe?: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const wide = useWide();
  const { api } = useAuth();
  const { state } = useSession();
  const errText = useErrorText();
  const kehilaId = state.kehila?.kehilaId;
  const docRef = React.useRef<TreeDoc | null>(null);
  const [doc, setDoc] = React.useState<TreeDoc | null>(null);
  const [picked, setPicked] = React.useState<Picked>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (text: string) => { setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3500); };
  React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const profile = state.me?.profile;
  const account = profile ? { name: `${profile.firstName} ${profile.lastName ?? ''}`.trim(), phone: profile.phone ?? null } : undefined;

  const onSave = async (people: Parameters<React.ComponentProps<typeof PersonSheet>['onSave']>[0], feed: number): Promise<SaveOutcome> => {
    const cur = docRef.current;
    if (!kehilaId || !cur) return { ok: false, message: t('errors.version_conflict') };
    try {
      const out = await saveTree(api, kehilaId, people, cur.version);
      docRef.current = out.doc; setDoc(out.doc);
      if (!out.ok) { say(t('tree.conflictNotSaved')); return { ok: false, message: t('tree.conflictNotSaved') }; } // reloaded underneath; the sheet keeps the draft (it rebases onto the new tree)
      say(feed > 0 ? t(feed === 1 ? 'tree.feedDoneOne' : 'tree.feedDone', { n: feed }) : t('tree.saved'));
      return { ok: true };
    } catch (e) { return { ok: false, message: errText(e) }; }
  };
  const openId = (id: string) => setPicked(open({ id }));
  const openSlot = (slot: Slot) => setPicked(open({ create: slot }));
  const target = picked?.target;
  const exists = !!target && ('id' in target ? !!docRef.current?.people.some(p => p.id === target.id) : true);
  const title = picked && exists ? sheetTitle(docRef.current?.people ?? [], picked.target, t) : '';
  const content = picked && exists && docRef.current ? (
    <PersonSheet key={picked.key} myId={state.me?.userId ?? null} people={docRef.current.people} target={picked.target} newId={picked.newId} readOnly={readOnly} account={account} onOpenMe={onOpenMe}
      onSave={onSave} onOpen={next => setPicked(open(next))} onClose={() => setPicked(null)} />
  ) : null;
  const selectedId = picked && 'id' in picked.target ? picked.target.id : null;
  const panel = wide ? (
    picked && content ? (
      <View style={{ flex: 1 }} testID="tree-panel">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 8 }}>
          <Txt serif size="title" accessibilityRole="header" style={{ flex: 1 }} content>{title}</Txt>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setPicked(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={22} color={k.ink} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }}>{content}</ScrollView>
      </View>
    ) : <View style={{ padding: 16 }}><Txt color={k.muted}>{t('tree.legend.tap')}</Txt></View>
  ) : undefined;
  return (
    <View style={{ flex: 1 }}>
      <TreeScreen onBack={onBack} readOnly={readOnly} familyId={familyId} familyName={familyName} selectedId={selectedId}
        onOpenPerson={openId} onOpenSlot={openSlot} onDoc={d => { docRef.current = d; }} doc={doc} panel={panel} />
      {!wide ? <Sheet visible={!!picked && !!content} title={title} onClose={() => setPicked(null)}>{content}</Sheet> : null}
      <Toast text={toast ?? ''} visible={!!toast} />
    </View>
  );
}
