import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Chip, Field, Segmented, Sheet, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { ForwardIcon } from '../../kit/Icon.tsx';
import { Figure } from '../../tree/Figure.tsx';
import { fromGregorian } from '../../tree/dates.ts';
import type { ShabbatInfo } from '../../tree/dates.ts';
import { gregOf, gregText, hebrewText } from '../../tree/format.ts';
import { relationLabel, roleWord, nameOrRole } from '../../tree/labels.ts';
import { aliyahName, prayerName } from '../../tree/names.ts';
import { childrenOf, fatherNameOf, motherNameOf } from '../../tree/relations.ts';
import {
  batMitzvahOf, canClear, canRemove, clearPerson, commit, feedWarning, hasBarMitzvah, hasBatMitzvah, isDirty, parentField, removePerson,
  sheetErrors, sheetReducer, startSheet, suggestionOf,
} from '../../tree/sheet.ts';
import type { SheetError, SheetState, Target } from '../../tree/sheet.ts';
import type { Person, Tribe } from '../../tree/types.ts';
import { BarMitzvahPicker, shabbatLine } from './BarMitzvahPicker.tsx';
import { FigurePicker } from './FigurePicker.tsx';
import { HebrewDateField } from './HebrewDateField.tsx';

export type SaveOutcome = { ok: true } | { ok: false; message: string };
export type { SheetError };
const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
let counter = 0;
/** A client-made id for a figure created from a typed parent name (matches the server's id pattern). */
export const makeId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The title of the sheet / panel: the figure's name, or "הוספת …" for a new one. */
export function sheetTitle(people: Person[], target: Target, t: (k: string, p?: Record<string, string | number>) => string): string {
  if ('id' in target) { const p = people.find(x => x.id === target.id); return p ? nameOrRole(p, t) : ''; }
  return t('tree.newTitle', { role: roleWord(target.create, t) });
}

/** One name as drawn pieces: a blank (gold, dashed) stands for each missing part. */
function pieces(tree: Person[], p: Person, parent: 'father' | 'mother', memorial: boolean, tribe: boolean) {
  const first = p.hebrewFirst?.trim();
  const name = parent === 'father' ? fatherNameOf(tree, p.id) : motherNameOf(tree, p.id);
  const suffix = tribe ? (aliyahName(tree, p.id).text.match(/ (הכהן|הלוי)$/)?.[0] ?? '') : '';
  const out: { text: string; blank?: boolean }[] = [];
  if (!first && !name) return [{ text: '', blank: true }];
  out.push(first ? { text: first } : { text: '', blank: true }, { text: p.gender === 'm' ? ' בן ' : ' בת ' }, name ? { text: name + suffix } : { text: '', blank: true });
  if (memorial) out.push({ text: ' ז״ל' });
  return out;
}
function Name({ list, size = 'title' }: { list: { text: string; blank?: boolean }[]; size?: 'title' | 'body' }) {
  const k = useTokens();
  return (
    <Txt serif={size === 'title'} size={size} content>
      {list.map((x, i) => x.blank
        ? <Txt key={i} serif={size === 'title'} size={size} color={k.gold} style={{ textDecorationLine: 'underline', textDecorationStyle: 'dashed' }}>{'      '}</Txt>
        : <Txt key={i} serif={size === 'title'} size={size} content>{x.text}</Txt>)}
    </Txt>
  );
}

/** The computed name card (§17.4 item 2): men aliyah (+ Mi Sheberach line), women Mi Sheberach only, the deceased memorial; gold edge when incomplete. */
function NameCard({ tree, p }: { tree: Person[]; p: Person }) {
  const { t } = useI18n();
  const k = useTokens();
  const deceased = !!p.deceased;
  const man = p.gender === 'm';
  const main = deceased ? 'father' : man ? 'father' : 'mother';
  const name = deceased ? aliyahName(tree, p.id) : man ? aliyahName(tree, p.id) : prayerName(tree, p.id);
  const miss = name.missing.includes('first') && name.missing.length === 1 ? t('tree.name.missFirst') : name.missing.includes(main) ? t(main === 'father' ? 'tree.name.missFather' : 'tree.name.missMother') : name.missing.includes('first') ? t('tree.name.missFirst') : '';
  const label = deceased ? t('tree.name.memorial') : man ? t('tree.name.aliyah') : t('tree.name.mi');
  const miLine = !deceased && man ? prayerName(tree, p.id) : null;
  const edge = deceased ? k.ash : miss || (miLine && miLine.missing.length) ? k.gold : k.tekhelet;
  const death = deceased && p.death ? hebrewText(p.death) : '';
  return (
    <Card edgeColor={edge}>
      <Txt size="caption" bold color={miss ? k.gold : k.tekhelet}>{miss ? `${label} · ${miss}` : label}</Txt>
      <Name list={pieces(tree, p, main, deceased, p.gender === 'm')} />
      {miLine ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <Txt size="small" color={k.muted}>{`${t('tree.name.mi')}: `}</Txt>
          <Name size="body" list={pieces(tree, p, 'mother', false, false)} />
          {miLine.missing.includes('mother') ? <Txt size="small" bold color={k.gold}>{` · ${t('tree.name.missMother')}`}</Txt> : null}
        </View>
      ) : null}
      {death ? <Txt size="small" color={k.muted}>{t('tree.name.diedOn', { hdate: death })}</Txt> : null}
    </Card>
  );
}

function LinkRow({ title, sub, action, onPress, testID, me, person, tree }: { title: string; sub?: string; action: string; onPress: () => void; testID?: string; me?: boolean; person?: Person; tree?: Person[] }) {
  const k = useTokens();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title}${sub ? `, ${sub}` : ''}. ${action}`} onPress={onPress}
      style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
      {person && tree ? <Figure person={person} size={40} style="B" /> : null}
      <View style={{ flex: 1 }}>
        <Txt bold content>{title}</Txt>
        {sub ? <Txt size="caption" color={me ? k.gold : k.muted} content>{sub}</Txt> : null}
      </View>
      <Txt size="small" bold color={k.tekhelet}>{action}</Txt>
      <ForwardIcon color={k.tekhelet} />
    </Pressable>
  );
}

const SECTION_GAP = 14;
const TRIBES: Tribe[] = ['kohen', 'levi', 'yisrael'];
const errKey: Record<SheetError, string> = { yearRange: 'tree.err.yearRange', partialBirth: 'tree.err.partialDate', partialDeath: 'tree.err.partialDate', birthFuture: 'tree.err.future', deathFuture: 'tree.err.future', deathBeforeBirth: 'tree.err.deathBeforeBirth' };

export type SheetProps = {
  /** The tree as saved. */
  people: Person[];
  target: Target;
  /** Id for the figure when `target` creates one. */
  newId: string;
  /** Gabbai: the family's tree, read only. */
  readOnly?: boolean;
  /** Me: shown read-only on my own figure, with the link to "הפרטים שלי". */
  account?: { name: string; phone?: string | null };
  onOpenMe?: () => void;
  /** Writes the whole tree. `feed`: how many children's names changed (the toast). */
  onSave: (people: Person[], feed: number) => Promise<SaveOutcome>;
  /** Another figure (the parent's, the spouse's, a grandchild's, a new spouse): the caller opens it after this sheet is saved. */
  onOpen: (target: Target) => void;
  onClose: () => void;
};

/**
 * The person sheet (UX-DESIGN §17.4, P32): the figure's short form. The draft lives in `sheetReducer`; "שמירה" writes the whole
 * tree through `onSave`. Moving to another figure first saves what was changed here.
 */
export function PersonSheet({ people, target, newId, readOnly, account, onOpenMe, onSave, onOpen, onClose }: SheetProps) {
  const { t, lang } = useI18n();
  const arrow = lang === 'he' ? '‹' : '›';
  const k = useTokens();
  const [state, dispatch] = React.useReducer(sheetReducer, undefined, () => startSheet(people, target, newId));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<'remove' | 'clear' | null>(null);
  const [picker, setPicker] = React.useState<'shabbat' | 'figure' | null>(null);
  React.useEffect(() => { if (people !== state.base) dispatch({ type: 'rebase', base: people }); }, [people]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = state.draft;
  const mkId = React.useRef(makeId).current;
  const preview = React.useMemo(() => { let n = 0; return commit(state, () => `preview-${n++}`); }, [state]);
  const me = preview.find(p => p.id === d.id) ?? ({ id: d.id, relation: d.relation, gender: d.gender } as Person);
  const errors = sheetErrors(d, today());
  const feed = feedWarning(state);
  const existing = people.find(p => p.id === d.id);
  const mine = d.relation === 'self';

  const save = async (then?: () => void) => {
    if (errors.length) { setError(t(errKey[errors[0]!])); return; }
    setBusy(true); setError(null);
    const out = await onSave(commit(state, mkId), feed);
    setBusy(false);
    if (!out.ok) { setError(out.message); return; }
    then ? then() : onClose();
  };
  /** Opens another figure; what changed here is saved first. */
  const go = (next: Target) => { if (readOnly || !isDirty(state)) onOpen(next); else void save(() => onOpen(next)); };
  const removeNow = async (people2: Person[]) => {
    setBusy(true); setError(null);
    const out = await onSave(people2, 0);
    setBusy(false);
    if (!out.ok) setError(out.message); else onClose();
  };

  if (readOnly) return <ReadOnly tree={people} p={existing ?? me} />;

  const text = (key: 'hebrewFirst' | 'surname', label: string, hint?: string) => (
    <View style={{ gap: 4 }}>
      <Field testID={`sheet-${key}`} label={label} value={d[key]} onChangeText={value => dispatch({ type: 'text', key, value })} maxLength={40} autoCapitalize="none" />
      {hint ? <Txt size="caption" color={k.muted}>{hint}</Txt> : null}
    </View>
  );
  const parentRow = (which: 'father' | 'mother') => {
    const f = parentField(state, which);
    if (f.mode === 'none') return null;
    const key = which === 'father' ? 'fatherName' : 'motherName';
    const label = t(which === 'father' ? 'tree.f.father' : 'tree.f.mother');
    if (f.mode === 'tree') {
      return (
        <View key={which} style={{ gap: 6 }}>
          <Txt size="small" bold>{label}</Txt>
          <Pressable testID={`sheet-${key}-tree`} accessibilityRole="button" accessibilityLabel={`${label}: ${f.name}. ${t('tree.f.fromTree')}`} onPress={() => go({ id: f.figureId })}
            style={{ minHeight: 48, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: k.line, backgroundColor: k.stone, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Txt serif size="body" color={k.muted} content style={{ flexShrink: 1 }}>{f.name}</Txt>
            <Txt size="small" bold color={k.tekhelet}>{`${t('tree.f.fromTree')} ${arrow}`}</Txt>
          </Pressable>
        </View>
      );
    }
    return (
      <View key={which} style={{ gap: 4 }}>
        <Field testID={`sheet-${key}`} label={label} value={d[key]} onChangeText={value => dispatch({ type: 'text', key, value })} maxLength={40} placeholder={t(which === 'father' ? 'tree.f.fatherPh' : 'tree.f.motherPh')} />
        {f.fillsFigure ? <Txt size="caption" color={k.muted}>{t(which === 'father' ? 'tree.f.fillsFather' : 'tree.f.fillsMother')}</Txt> : null}
      </View>
    );
  };

  const kind = d.relation === 'grandchild' || (state.isNew && d.relation === 'child');
  const showTribe = d.gender === 'm' && d.relation !== 'grandchild';
  const showSurname = d.relation !== 'child' && d.relation !== 'grandchild';
  const showBirth = d.relation === 'self' || d.relation === 'spouse' || d.relation === 'child' || d.relation === 'grandchild';
  const showAlive = !(d.relation === 'childSpouse' || d.relation === 'grandchild' || d.relation === 'formerSpouse' || d.relation === 'self' || existing?.userId);
  const suggestion = suggestionOf(d);
  const bm = d.barMitzvah?.manual ? d.barMitzvah : suggestion ? { date: suggestion.date, parasha: suggestion.parasha, manual: false as const, ...(suggestion.parasha ? {} : { label: suggestion.label }) } : d.barMitzvah;
  const bat = batMitzvahOf(d);
  const spouse = d.relation === 'child' ? preview.find(p => p.relation === 'childSpouse' && p.of === d.id) : undefined;
  const ofChild = d.relation === 'childSpouse' ? preview.find(p => p.id === d.of) : undefined;
  const grandkids = existing && (d.relation === 'child' || d.relation === 'childSpouse') ? childrenOf(people, d.id) : [];
  const childId = d.relation === 'child' ? d.id : d.relation === 'childSpouse' ? d.of : undefined;
  const spouseTab = d.relation === 'child' ? spouse : d.relation === 'childSpouse' ? me : undefined;
  const childTab = d.relation === 'child' ? me : ofChild;

  return (
    <View style={{ gap: SECTION_GAP }} testID="person-sheet">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('tree.fig.link')} onPress={() => setPicker('figure')} testID="sheet-figure">
          <Figure person={me} size={84} style="A" />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt serif size="title" content numberOfLines={2}>{`${me.hebrewFirst ?? ''} ${me.surname ?? ''}`.trim() || roleWord(me, t)}{me.deceased ? ` ${t('tree.zl')}` : ''}</Txt>
          <Txt size="small" color={k.muted} content>{relationLabel(preview, me, t)}</Txt>
          <Pressable accessibilityRole="button" onPress={() => setPicker('figure')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Txt size="small" bold color={k.tekhelet}>{`${t('tree.fig.link')} ${arrow}`}</Txt>
          </Pressable>
        </View>
      </View>

      {spouseTab && childTab && childId && !state.isNew ? (
        <Segmented<'child' | 'spouse'> value={d.relation === 'child' ? 'child' : 'spouse'} onChange={key => { if (key !== (d.relation === 'child' ? 'child' : 'spouse')) go({ id: key === 'child' ? childTab.id : spouseTab.id }); }}
          options={[{ key: 'child', label: nameOrRole(childTab, t) }, { key: 'spouse', label: nameOrRole(spouseTab, t) }]} />
      ) : null}

      <NameCard tree={preview} p={me} />

      {mine && account ? (
        <Card>
          <Txt size="small" bold>{t('tree.account.app')}</Txt>
          <Txt content>{account.name}</Txt>
          <Txt size="small" bold>{t('tree.account.phone')}</Txt>
          {account.phone ? <Txt content style={{ textAlign: 'left', writingDirection: 'ltr' }}>{account.phone}</Txt> : <Txt color={k.muted}>{t('tree.account.none')}</Txt>}
          {onOpenMe ? <Pressable testID="sheet-open-me" accessibilityRole="button" onPress={() => (isDirty(state) ? void save(onOpenMe) : onOpenMe())} style={{ minHeight: 44, justifyContent: 'center' }}><Txt bold color={k.tekhelet}>{`${t('tree.account.edit')} ${arrow}`}</Txt></Pressable> : null}
        </Card>
      ) : null}

      {feed > 0 ? <Banner tone="info" text={t(d.gender === 'm' ? (feed === 1 ? 'tree.feedWarnFatherOne' : 'tree.feedWarnFather') : (feed === 1 ? 'tree.feedWarnMotherOne' : 'tree.feedWarnMother'), { n: feed })} /> : null}

      {kind ? (
        <Segmented<'m' | 'f'> value={d.gender} onChange={gender => dispatch({ type: 'gender', gender })} options={[{ key: 'm', label: t('tree.role.son') }, { key: 'f', label: t('tree.role.daughter') }]} />
      ) : null}

      {showSurname ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>{text('hebrewFirst', t('tree.f.first'))}</View>
          <View style={{ flex: 1 }}>{text('surname', t('tree.f.surname'))}</View>
        </View>
      ) : text('hebrewFirst', t('tree.f.first'))}
      {showSurname ? <Txt size="caption" color={k.muted}>{t('tree.f.firstHint')}</Txt> : null}

      {(['father', 'mother'] as const).map(parentRow)}

      {showTribe ? (
        <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={t('tree.f.tribe')}>
          <Txt size="small" bold>{t('tree.f.tribe')}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {TRIBES.map(tr => <Chip key={tr} label={t(`tree.f.${tr}`)} selected={d.tribe === tr} onPress={() => dispatch({ type: 'tribe', tribe: tr })} />)}
          </View>
          {state.isNew && d.relation === 'child' && d.tribe ? <Txt size="caption" color={k.muted}>{t('tree.f.fromFather')}</Txt> : null}
        </View>
      ) : null}

      {showBirth ? <HebrewDateField testID="sheet-birth" label={t('tree.f.birth')} part={d.birth} onChange={part => dispatch({ type: 'birth', part })} /> : null}
      {errors.includes('birthFuture') ? <Banner tone="error" text={t('tree.err.future')} /> : null}
      {errors.includes('yearRange') ? <Banner tone="error" text={t('tree.err.yearRange')} /> : null}
      {errors.includes('partialBirth') ? <Banner tone="error" text={t('tree.err.partialDate')} /> : null}

      {hasBarMitzvah(d) ? (
        <Card edgeColor={k.tekhelet}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Txt size="small" bold>{t('tree.bm.title')}</Txt>
            {bm ? <Tag tone={bm.manual ? 'strong' : 'plain'} label={t(bm.manual ? 'tree.bm.manual' : 'tree.bm.suggested')} /> : null}
          </View>
          {bm && (suggestion || bm.manual) ? (
            <Txt serif size="heading" content>{shabbatLine({ date: bm.date, parasha: bm.parasha, label: bm.label ?? `${t('tree.bm.shabbatOf')} ${bm.parasha}` })}</Txt>
          ) : <Txt size="small" color={k.muted}>{t('tree.bm.afterBirthDate')}</Txt>}
          {suggestion && bm ? <Txt size="caption" color={k.muted}>{t('tree.bm.why')}</Txt> : null}
          {suggestion || bm ? (
            <Pressable testID="bm-change" accessibilityRole="button" onPress={() => setPicker('shabbat')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Txt bold color={k.tekhelet}>{`${t('tree.bm.change')} ${arrow}`}</Txt>
            </Pressable>
          ) : null}
          {bm?.manual && suggestion ? (
            <Pressable testID="bm-reset" accessibilityRole="button" onPress={() => dispatch({ type: 'takeSuggestion' })} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Txt bold color={k.tekhelet} style={{ textDecorationLine: 'underline' }}>{t('tree.bm.reset', { parasha: suggestion.label, date: gregText(suggestion.date) })}</Txt>
            </Pressable>
          ) : null}
        </Card>
      ) : null}
      {state.takePrompt && suggestion ? (
        <Banner text={t('tree.bm.keepAsk', { shabbat: shabbatLine(suggestion) })} action={{ title: t('tree.bm.takeNew'), onPress: () => dispatch({ type: 'takeSuggestion' }) }} />
      ) : null}
      {state.takePrompt ? <Button kind="secondary" title={t('tree.bm.keepMine')} onPress={() => dispatch({ type: 'keepManual' })} /> : null}

      {hasBatMitzvah(d) && bat ? (
        <Card edgeColor={k.tekhelet}>
          <Txt size="small" bold>{t('tree.batm.title')}</Txt>
          <Txt serif size="heading" content>{`${hebrewText(fromGregorian(bat))} · ${gregText(bat)}`}</Txt>
          <Txt size="caption" color={k.muted}>{t('tree.batm.note')}</Txt>
        </Card>
      ) : null}

      {showAlive ? (
        <View style={{ gap: 10 }}>
          <Segmented<'alive' | 'dead'> value={d.deceased ? 'dead' : 'alive'} onChange={key => dispatch({ type: 'alive', deceased: key === 'dead' })}
            options={[{ key: 'alive', label: t('tree.f.alive') }, { key: 'dead', label: t('tree.f.deceased') }]} />
          {d.deceased ? <HebrewDateField testID="sheet-death" label={t('tree.f.death')} part={d.death} onChange={part => dispatch({ type: 'death', part })} /> : null}
          {d.deceased && errors.includes('deathBeforeBirth') ? <Banner tone="error" text={t('tree.err.deathBeforeBirth')} /> : null}
          {d.deceased && errors.includes('deathFuture') ? <Banner tone="error" text={t('tree.err.future')} /> : null}
        </View>
      ) : null}

      {d.relation === 'child' && existing && !spouse ? (
        <Pressable testID="sheet-add-spouse" accessibilityRole="button" onPress={() => go({ create: { relation: 'childSpouse', of: d.id, gender: d.gender === 'm' ? 'f' : 'm' } })} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Txt bold color={k.tekhelet}>{`+ ${t('tree.married')}`}</Txt>
        </Pressable>
      ) : null}
      {d.relation === 'child' && state.isNew ? <Txt size="caption" color={k.muted}>{t('tree.marriedAfter')}</Txt> : null}

      {childId && existing && !state.isNew && (d.relation === 'childSpouse' || spouse || grandkids.length) ? (
        <View style={{ gap: 8 }}>
          <Txt bold>{t('tree.grandkids', { n: grandkids.length })}</Txt>
          {grandkids.map(g => (
            <LinkRow key={g.id} testID={`sheet-grandkid-${g.id}`} person={g} tree={people} title={nameOrRole(g, t)} sub={(g.gender === 'm' ? aliyahName(people, g.id) : prayerName(people, g.id)).text || undefined}
              action={t('tree.details')} onPress={() => go({ id: g.id })} />
          ))}
          {grandkids.length < 20 ? (
            <Pressable testID="sheet-add-grandkid" accessibilityRole="button" onPress={() => go({ create: { relation: 'grandchild', of: childId, gender: 'm' } })} style={{ minHeight: 48, justifyContent: 'center' }}>
              <Txt bold color={k.tekhelet}>{`+ ${t('tree.addGrandkid')}`}</Txt>
            </Pressable>
          ) : null}
          <Txt size="caption" color={k.muted}>{t('tree.grandkidsNote')}</Txt>
        </View>
      ) : null}

      {error ? <Banner tone="error" text={error} /> : null}
      <View testID="sheet-save"><Button title={t(state.isNew ? 'tree.add' : 'tree.save')} busy={busy} onPress={() => void save()} /></View>

      {existing && canRemove(existing) ? (
        confirm === 'remove' ? (
          <Card>
            <Txt>{t('tree.remove', { name: nameOrRole(existing, t), partner: partnerName(people, existing, t) })}</Txt>
            <Button kind="danger" title={t('tree.removeYes')} busy={busy} onPress={() => void removeNow(removePerson(people, existing.id))} />
            <Button kind="secondary" title={t('tree.keep')} onPress={() => setConfirm(null)} />
          </Card>
        ) : <Button kind="secondary" icon="trash" title={t('tree.removeAction')} onPress={() => setConfirm('remove')} />
      ) : null}
      {existing && canClear(existing) ? (
        confirm === 'clear' ? (
          <Card>
            <Txt>{t('tree.clearAsk', { name: nameOrRole(existing, t) })}</Txt>
            <Button kind="danger" title={t('tree.clearYes')} busy={busy} onPress={() => void removeNow(clearPerson(people, existing.id))} />
            <Button kind="secondary" title={t('tree.keep')} onPress={() => setConfirm(null)} />
          </Card>
        ) : <Button kind="secondary" title={t('tree.clear')} onPress={() => setConfirm('clear')} />
      ) : null}

      <Sheet visible={picker === 'shabbat'} title={t('tree.bm.title')} onClose={() => setPicker(null)}>
        <BarMitzvahPicker from={bm?.date ?? suggestion?.date} years={yearsAround(d.birth.year)} onSet={(info: ShabbatInfo) => { dispatch({ type: 'shabbat', info }); setPicker(null); }} />
      </Sheet>
      <Sheet visible={picker === 'figure'} title={t('tree.fig.title')} onClose={() => setPicker(null)}>
        <FigurePicker person={me} onSave={figure => { dispatch({ type: 'figure', figure }); setPicker(null); }} />
      </Sheet>
    </View>
  );
}

/** Hebrew years the Shabbat picker offers: from the 12th to the 18th birthday year. */
const yearsAround = (birthYear?: number): [number, number] => (birthYear ? [birthYear + 12, birthYear + 18] : [5780, 5800]);

/** The other adult in the sentence "removed for {partner} too": the other adult, or "the family". */
function partnerName(people: Person[], p: Person, t: (k: string) => string): string {
  const other = people.find(x => (x.relation === 'self' || x.relation === 'spouse') && x.id !== p.id && x.hebrewFirst?.trim());
  return other?.hebrewFirst?.trim() ?? t('tree.theFamily');
}

/** The gabbai's view: the same card and the values, nothing to edit. */
function ReadOnly({ tree, p }: { tree: Person[]; p: Person }) {
  const { t } = useI18n();
  const k = useTokens();
  const rows: [string, string][] = [
    [t('tree.f.first'), p.hebrewFirst ?? ''], [t('tree.f.surname'), p.surname ?? ''],
    [t('tree.f.father'), fatherNameOf(tree, p.id) ?? ''], [t('tree.f.mother'), motherNameOf(tree, p.id) ?? ''],
    ...(p.gender === 'm' ? [[t('tree.f.tribe'), p.tribe ? t(`tree.f.${p.tribe}`) : '']] as [string, string][] : []),
    [t('tree.f.birth'), p.birth ? [hebrewText(p.birth), gregOf(p.birth) ? gregText(gregOf(p.birth)!) : ''].filter(Boolean).join(' · ') : ''],
    ...(p.deceased ? [[t('tree.f.deceased'), p.death ? hebrewText(p.death) : '—']] as [string, string][] : []),
  ];
  return (
    <View style={{ gap: SECTION_GAP }} testID="person-sheet-readonly">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Figure person={p} size={84} style="A" />
        <Txt size="small" color={k.muted} content style={{ flex: 1 }}>{relationLabel(tree, p, t)}</Txt>
      </View>
      <NameCard tree={tree} p={p} />
      {rows.filter(r => r[1]).map(([label, value]) => (
        <View key={label} style={{ gap: 2 }}><Txt size="caption" bold color={k.muted}>{label}</Txt><Txt content>{value}</Txt></View>
      ))}
      <Txt size="caption" color={k.muted}>{t('tree.readOnly')}</Txt>
    </View>
  );
}
