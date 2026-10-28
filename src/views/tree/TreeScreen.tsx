import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Pressable, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import type { TreeDoc } from '../../client/tree.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Segmented, Txt, useTokens } from '../../kit/components.tsx';
import { BackIcon, Icon } from '../../kit/Icon.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { coupleLabel, figureLabel, isMe, nameOrRole, pairName, relationLabel, roleWord, stateWords } from '../../tree/labels.ts';
import type { ChildTile, ParentCard, Slot, Spot } from '../../tree/layout.ts';
import { levelDown, needsDetails, treeLayout } from '../../tree/layout.ts';
import type { Person } from '../../tree/types.ts';
import { useErrorText } from '../auth/Frame.tsx';
import { FigureTile } from './TreeParts.tsx';
import { TreeList } from './TreeList.tsx';

export const WIDE_FROM = 900;
const VIEW_KEY = 'kehilot.tree.view';
type Mode = 'tree' | 'list';

/** True from 900 px: the side panel replaces the bottom sheet (§17.6). */
export const useWide = () => useWindowDimensions().width >= WIDE_FROM;

function BackRow({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const k = useTokens();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{label}</Txt></View>
    </Pressable>
  );
}

/**
 * The family tree (UX-DESIGN §17.2, P31/P33): parents above, our couple, the children. "ההורים שלהם" moves the centre one
 * generation up (breadcrumb, back, "חזרה ל…"); the list view is the same people in words. `readOnly` is the gabbai's view
 * of one family: no "+", no empty slots to tap. Tapping a figure calls `onOpenPerson` (the sheet is the caller's).
 */
export function TreeScreen({ onBack, onOpenPerson, onOpenSlot, selectedId, panel, top, pendingSpouse, readOnly, familyId, familyName, onPeople, onDoc, doc: external }: {
  onBack: () => void;
  onOpenPerson: (id: string) => void;
  /** An empty place or the "+ child" tile was tapped. */
  onOpenSlot: (slot: Slot) => void;
  selectedId?: string | null;
  /** Under the title: the partner-request banner. */
  top?: React.ReactNode;
  /** A request I sent is waiting: the empty spouse place shows this name and "ממתין לאישור". */
  pendingSpouse?: string | null;
  /** Wide screens: the side panel's content (400 px at the inline end). */
  panel?: React.ReactNode;
  readOnly?: boolean;
  /** Gabbai: the family whose tree this is. */
  familyId?: string;
  familyName?: string;
  /** Called with the loaded people (the caller resolves ids to figures). */
  onPeople?: (people: Person[]) => void;
  /** Called with the loaded document (version included). */
  onDoc?: (doc: TreeDoc) => void;
  /** A newer document from the caller (after a save, or after a conflict): shown instead of what was loaded. */
  doc?: TreeDoc | null;
}) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const wide = useWide();
  const kehilaId = state.kehila?.kehilaId;
  const myId = state.me?.userId ?? null;
  const [doc, setDoc] = React.useState<TreeDoc | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>('tree');
  const [centre, setCentre] = React.useState<string | null>(null);
  const [gridWidth, setGridWidth] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!kehilaId) return;
    try {
      setDoc(familyId ? await api.adminFamilyTree(kehilaId, familyId) : await api.familyTree(kehilaId));
      setError(null);
    } catch (e) { setError(errText(e)); }
  }, [api, kehilaId, familyId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    let live = true;
    AsyncStorage.getItem(VIEW_KEY).then(v => { if (live && (v === 'tree' || v === 'list')) setMode(v); }, () => {});
    return () => { live = false; };
  }, []);
  const chooseMode = (m: Mode) => { setMode(m); void AsyncStorage.setItem(VIEW_KEY, m).catch(() => {}); };

  React.useEffect(() => { if (external) setDoc(external); }, [external]);
  React.useEffect(() => { if (doc) onDoc?.(doc); }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = React.useMemo(() => doc?.people ?? [], [doc]);
  React.useEffect(() => { onPeople?.(people); }, [people]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = React.useMemo(() => treeLayout(people, centre), [people, centre]);
  const root = layout.root;
  const cols = wide ? 5 : 3;
  const GAP = 8;
  const tileW = gridWidth > 0 ? Math.floor((gridWidth - GAP * (cols - 1)) / cols) : undefined;

  const mine = (p: Person) => !!myId && p.userId === myId;
  const who = { myId, neutral: readOnly };
  const missing = (p: Person) => needsDetails(people, p);
  const person = (p: Person, o: { big?: boolean; box?: boolean; ring?: boolean; partner?: Person; testID?: string } = {}) => {
    const name = o.partner ? pairName(p, o.partner, t) : nameOrRole(p, t);
    const states = [...stateWords(people, p, t), ...(o.partner ? stateWords(people, o.partner, t) : [])];
    const rel = o.partner ? t('tree.rel.married', { kind: roleWord(p, t) }) : relationLabel(people, p, t, who);
    const label = figureLabel({ relation: o.ring ? `${rel}, ${t('tree.fromHere')}` : rel, name, deceased: !o.partner && p.deceased, states }, t);
    return (
      <FigureTile key={p.id} testID={o.testID ?? `tree-fig-${p.id}`} person={p} partner={o.partner} name={name} label={label} big={o.big} box={o.box} ring={o.ring} size={o.box ? 52 : undefined}
        dot={missing(p) || (!!o.partner && missing(o.partner))} deceased={!o.partner && p.deceased} ill={!p.deceased && !!p.ill || (!!o.partner && !o.partner.deceased && !!o.partner.ill)} me={!readOnly && mine(p) && !!p.hebrewFirst?.trim()} selected={selectedId === p.id || (!!o.partner && selectedId === o.partner.id)}
        width={tileW} onPress={() => onOpenPerson(p.id)} />
    );
  };
  const slotTile = (slot: Slot, big?: boolean) => {
    const role = roleWord({ relation: slot.relation, gender: slot.gender }, t);
    const rel = relationLabel(people, { id: '', relation: slot.relation, of: slot.of, gender: slot.gender } as Person, t, who);
    if (pendingSpouse && slot.relation === 'spouse' && !readOnly) {
      return <FigureTile key="spouse-pending" testID="tree-slot-pending" name={pendingSpouse} tag={t('tree.link.pending')} big={big} label={`${rel}: ${t('tree.link.pendingA11y', { name: pendingSpouse })}`} onPress={() => onOpenSlot(slot)} />;
    }
    return <FigureTile key={`${slot.relation}-${slot.of ?? ''}`} testID={`tree-slot-${slot.relation}-${slot.of ?? 'none'}`} name={role} empty readOnly={readOnly} big={big} label={`${rel}: ${t('tree.emptySlotA11y', { role })}. ${t('tree.open')}`} onPress={() => onOpenSlot(slot)} />;
  };
  const spot = (s: Spot, big?: boolean) => (s.person ? person(s.person, { big }) : slotTile(s.slot, big));

  const cardView = (c: ParentCard, solo: boolean) => {
    const adult = people.find(p => p.id === c.ofId);
    const adultName = adult ? nameOrRole(adult, t) : '';
    return (
      <View key={c.ofId} accessibilityRole="summary" accessibilityLabel={t('tree.crumb', { name: adultName })}
        style={[{ backgroundColor: k.surface, borderWidth: 1, borderColor: k.line, borderRadius: 14, paddingHorizontal: 4, paddingBottom: 6 }, solo ? { width: '50%', alignSelf: 'center' } : { flex: 1 }]}>
        {c.upId ? (
          <Pressable testID={`tree-up-${c.ofId}`} accessibilityRole="button" accessibilityLabel={t('tree.upA11y', { name: adultName })} onPress={() => setCentre(c.upId)}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Icon name="up" size={18} color={k.tekhelet} /><Txt size="small" bold color={k.tekhelet} numberOfLines={1}>{t('tree.up')}</Txt>
          </Pressable>
        ) : <View style={{ minHeight: 44 }} />}
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>{spot(c.father)}</View>
          <View style={{ flex: 1 }}>{spot(c.mother)}</View>
        </View>
      </View>
    );
  };

  const header = (
    <>
      {root ? <BackRow label={t('me.back')} onPress={onBack} testID="tree-back" /> : <BackRow label={t('tree.title')} onPress={() => setCentre(levelDown(people, centre))} testID="tree-level-down" />}
      {root ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Txt serif size="title" accessibilityRole="header" style={{ flex: 1 }}>{familyId ? t('tree.titleOf', { name: familyName ?? '' }) : t('tree.title')}</Txt>
          <View style={{ width: 150 }}>
            <Segmented<Mode> options={[{ key: 'tree', label: t('tree.view.tree') }, { key: 'list', label: t('tree.view.list') }]} value={mode} onChange={chooseMode} />
          </View>
        </View>
      ) : (
        <Txt color={k.muted} accessibilityRole="header">
          {`${t('tree.title')} ‹ `}{layout.trail.map((p, i) => (i ? ' ‹ ' : '') + t('tree.crumb', { name: nameOrRole(p, t) })).join('')}
        </Txt>
      )}
      {root ? top : null}
      {root && mode === 'tree' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, columnGap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: k.gold }} /><Txt size="caption" color={k.muted}>{t('tree.legend.missing')}</Txt></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="flame" size={16} color={k.gold} /><Txt size="caption" color={k.muted}>{t('tree.legend.candle')}</Txt></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Txt size="caption" bold color={k.heal}>{'♡'}</Txt><Txt size="caption" color={k.muted}>{t('tree.ill.legend')}</Txt></View>
          <Txt size="caption" color={k.muted}>{t('tree.legend.tap')}</Txt>
        </View>
      ) : null}
    </>
  );

  let body: React.ReactNode;
  if (!doc) {
    body = error ? (
      <>
        <Banner tone="error" text={error} />
        <Button kind="secondary" title={t('common.retry')} onPress={() => void load()} />
      </>
    ) : <ActivityIndicator accessibilityLabel={t('tree.loading')} color={k.tekhelet} />;
  } else if (mode === 'list' && root) {
    body = <TreeList people={people} myId={myId} readOnly={readOnly} onOpenPerson={onOpenPerson} />;
  } else {
    const justMe = root && people.every(p => p.relation === 'self');
    const solo = layout.parents.length === 1;
    const coupleNames = coupleLabel(layout.couple.flatMap(s => (s.person ? [s.person] : [])), t);
    body = (
      <>
        {justMe && !readOnly ? (
          <Card edgeColor={k.tekhelet}>
            <Txt serif size="heading" accessibilityRole="header">{t('tree.start')}</Txt>
            <Txt size="small" color={k.muted}>{t('tree.startBody')}</Txt>
          </Card>
        ) : null}
        {justMe && readOnly && people.length === 0 ? <Card><Txt color={k.muted}>{t('tree.list.empty')}</Txt></Card> : null}
        <View>
          {layout.parents.length ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}>{layout.parents.map(c => cardView(c, solo))}</View>
              <View style={{ flexDirection: 'row', gap: 10, height: 16, justifyContent: 'center' }} accessible={false} importantForAccessibility="no-hide-descendants">
                {layout.parents.map(c => <View key={c.ofId} style={solo ? { width: '50%', alignSelf: 'center', alignItems: 'center' } : { flex: 1, alignItems: 'center' }}><View style={{ width: 2, flex: 1, backgroundColor: k.line }} /></View>)}
              </View>
            </>
          ) : null}
          <View accessibilityRole="summary" accessibilityLabel={coupleNames} style={{ backgroundColor: k.surface, borderWidth: 2, borderColor: k.tekhelet, borderRadius: 18, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 10, gap: 2 }}>
            <Txt serif size="heading" content style={{ textAlign: 'center' }}>{coupleNames}</Txt>
            <View style={{ flexDirection: 'row', gap: 10 }}>{layout.couple.map((s, i) => <View key={i} style={{ flex: 1 }}>{spot(s, true)}</View>)}</View>
          </View>
          {layout.children.length > 0 || !root ? (
            <View style={{ alignItems: 'center' }} accessible={false}>
              <View style={{ width: 2, height: 14, backgroundColor: k.line }} />
              <View style={{ paddingHorizontal: 12, paddingVertical: 2, borderRadius: 12, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
                <Txt size="small" color={k.muted}>{root ? t('tree.kids', { n: layout.children.length }) : t('tree.kidsOf')}</Txt>
              </View>
            </View>
          ) : null}
          <View onLayout={e => setGridWidth(e.nativeEvent.layout.width)} accessibilityRole="summary" accessibilityLabel={root ? t('tree.kids', { n: layout.children.length }) : t('tree.kidsOf')}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginTop: 10 }}>
            {layout.children.map((c: ChildTile) => person(c.person, { box: true, partner: c.partner, ring: !root }))}
            {root && layout.canAddChild && !readOnly ? (
              <FigureTile testID="tree-add-child" name={t('tree.addChild')} add box size={52} label={t('tree.addChildA11y')} width={tileW} onPress={() => onOpenSlot({ relation: 'child', gender: 'm' })} />
            ) : null}
          </View>
        </View>
        {root ? null : <Txt size="caption" color={k.muted}>{t('tree.noSiblings')}</Txt>}
        {root ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
            <View style={{ marginTop: 2 }}><Icon name="lock" size={16} color={k.muted} /></View>
            <Txt size="caption" color={k.muted} style={{ flex: 1 }}>{readOnly ? t('tree.readOnly') : (() => { const partner = layout.couple.map(s => s.person).find(p => p && (p.relation === 'spouse' || p.relation === 'self') && !isMe(people, p, who)); const n = partner?.hebrewFirst?.trim(); return n ? t('tree.privacy', { partner: n }) : t('tree.privacyAlone'); })()}</Txt>
          </View>
        ) : (
          <Pressable testID="tree-back-root" accessibilityRole="button" onPress={() => setCentre(null)} style={{ minHeight: TOUCH, borderRadius: 12, borderWidth: 1.5, borderColor: k.tekhelet, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('tree.backTo', { couple: rootCouple(people, t) })}</Txt>
          </Pressable>
        )}
      </>
    );
  }

  const column = (
    <PadScroll style={wide ? { flex: 1 } : undefined} contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 8, width: '100%', maxWidth: wide ? 760 : 680, alignSelf: 'center' }}>
      {header}
      {body}
    </PadScroll>
  );
  if (!wide || !panel) return column;
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {column}
      <View style={{ width: 400, borderStartWidth: 1, borderStartColor: k.line, backgroundColor: k.surface }}>{panel}</View>
    </View>
  );
}

/** "יוסף ומרים ישראלי": the root couple's name, for the way back. */
function rootCouple(people: Person[], t: Parameters<typeof coupleLabel>[1]): string {
  const root = treeLayout(people, null);
  return coupleLabel(root.couple.flatMap(s => (s.person ? [s.person] : [])), t);
}
