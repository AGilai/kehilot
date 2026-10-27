// Step 3 (UX-DESIGN §16.3, P28 frame 3): every household of the paste gets a decision. Nothing is linked silently: exact matches are
// confirmed together, once, after the list is shown. Pasted text is rendered only as text.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { textStart } from '../../../i18n/direction.ts';
import { Banner, Button, Card, Chip, PickList, Tag, Txt, useTokens } from '../../../kit/components.tsx';
import { cellKey, decisionCounts, exactDecisions, isDecisionValid, twoNameCells, effectiveFamilies } from '../../../seats/decisions.ts';
import type { CellChoice, Decision, MatchAction, MatchState } from '../../../seats/decisions.ts';
import { normalizeName, suggestMatches } from '../../../seats/match.ts';
import type { Holder, KehilaFamily, MatchResult } from '../../../seats/match.ts';
import type { ParsedFamily, ParsedHall } from '../../../seats/paste.ts';
import { rowText } from '../../../seats/savePlan.ts';
import { HallMini } from './HallMini.tsx';
import { Mono, Radio } from './bits.tsx';

type Pick = { opt: string; name: string; phone: string; link: string | null; query: string };
type Filter = 'all' | 'todo' | 'exact' | 'likely' | 'none' | 'check';

export function MatchStep({ parsed, blockNames, state, dispatch, families, holders, labelOf, onSave, onBack }: {
  parsed: ParsedHall; blockNames: string[]; state: MatchState; dispatch: React.Dispatch<MatchAction>;
  families: KehilaFamily[]; holders: Holder[]; /** "משפחת בדיוני (דנה ויוסי)" for a household id. */ labelOf: (kind: 'family' | 'holder', id: string) => string;
  onSave: () => void; onBack: () => void;
}) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const rows = React.useMemo(() => effectiveFamilies(parsed, state.cells), [parsed, state.cells]);
  const results = React.useMemo(() => new Map(suggestMatches(rows, families, holders).map((r) => [r.familyKey, r])), [rows, families, holders]);
  const twos = React.useMemo(() => twoNameCells(parsed), [parsed]);
  const dc = decisionCounts(parsed, state);
  const left = dc.todo;
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);
  const [showExact, setShowExact] = React.useState(false);
  const [picks, setPicks] = React.useState<Record<string, Pick>>({});
  const decided = (key: string) => isDecisionValid(state.decisions[key]);

  const bulk = React.useMemo(() => exactDecisions([...results.values()], state), [results, state]);
  const bulkKeys = Object.keys(bulk).filter((key) => rows.some((r) => r.familyKey === key));
  const flaggedKeys = React.useMemo(() => new Set(parsed.warnings.filter((w) => w.familyKey && w.code !== 'spans-blocks').map((w) => w.familyKey!)), [parsed]);
  const category = (key: string): Filter => { const r = results.get(key); return r?.level === 'exact' ? 'exact' : r?.level === 'likely' ? 'likely' : 'none'; };
  const counts: Record<Filter, number> = {
    all: dc.all, todo: dc.todo,
    exact: rows.filter((r) => category(r.familyKey) === 'exact').length, likely: rows.filter((r) => category(r.familyKey) === 'likely').length,
    none: rows.filter((r) => category(r.familyKey) === 'none').length, check: rows.filter((r) => flaggedKeys.has(r.familyKey)).length + dc.cellsTodo,
  };
  const q = normalizeName(query);
  const visible = rows.filter((r) => {
    if (q && !normalizeName(r.displayName).includes(q)) return false;
    if (filter === 'todo') return !decided(r.familyKey);
    if (filter === 'check') return flaggedKeys.has(r.familyKey);
    return filter === 'all' || category(r.familyKey) === filter;
  });
  const showTwos = (filter === 'all' || filter === 'todo' || filter === 'check') && !q ? twos.filter((c) => filter !== 'todo' || !state.cells[cellKey(c.row, c.col)]) : [];

  const defaultName = (f: ParsedFamily) => t('seatEditor.match.newName', { name: f.displayName });
  const pickOf = (f: ParsedFamily, r: MatchResult | undefined): Pick => picks[f.familyKey]
    ?? { opt: !r || r.candidates.length === 0 ? 'new' : r.candidates.length === 1 ? 'c:0' : '', name: defaultName(f), phone: '', link: null, query: '' };
  const setPick = (f: ParsedFamily, r: MatchResult | undefined, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [f.familyKey]: { ...pickOf(f, r), ...patch } }));
  const decisionOf = (pick: Pick, r: MatchResult | undefined): Decision | null => {
    if (pick.opt.startsWith('c:')) { const c = r?.candidates[Number(pick.opt.slice(2))]; return c ? (c.kind === 'family' ? { kind: 'family', id: c.id } : { kind: 'holder', id: c.id }) : null; }
    if (pick.opt === 'new') return { kind: 'new', name: pick.name, phone: pick.phone };
    if (pick.opt === 'link') return pick.link ? { kind: 'family', id: pick.link } : null;
    if (pick.opt === 'skip') return { kind: 'skip' };
    return null;
  };
  const describe = (d: Decision): string => d.kind === 'family' || d.kind === 'holder' ? labelOf(d.kind, d.id) : d.kind === 'new' ? t('seatEditor.match.decidedNew', { name: d.name }) : t('seatEditor.match.decidedSkip');
  const whereText = (f: ParsedFamily) => {
    const rowsOf = f.seats.map((s) => s.row);
    const lo = Math.min(...rowsOf), hi = Math.max(...rowsOf);
    const blocks = [...f.blocks].sort((a, b) => b - a).map((b) => blockNames[b] ?? '').filter(Boolean).join(' / ');
    return `${blocks} · ${t('seatEditor.match.rows', { rows: lo === hi ? rowText(parsed, lo) : `${rowText(parsed, lo)}–${rowText(parsed, hi)}` })}`;
  };
  const siblings = (f: ParsedFamily) => rows.filter((o) => o.familyKey !== f.familyKey && normalizeName(o.family) === normalizeName(f.family));
  const sel = rows.find((r) => r.familyKey === selected) ?? null;
  const lit = React.useMemo(() => new Set((sel?.seats ?? []).map((s) => cellKey(s.row, s.col))), [sel]);
  const selResult = sel ? results.get(sel.familyKey) : undefined;
  const selPick = sel ? pickOf(sel, selResult) : null;
  const whyCandidate = selPick?.opt.startsWith('c:') ? selResult?.candidates[Number(selPick.opt.slice(2))] : undefined;
  const nameInput = (value: string, onChange: (v: string) => void, label: string, placeholder?: string, ltr?: boolean, bad?: boolean) => (
    <TextInput accessibilityLabel={label} placeholder={placeholder ?? label} placeholderTextColor={k.muted} value={value} onChangeText={onChange}
      style={{ minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: bad ? k.danger : k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: 16, writingDirection: ltr ? 'ltr' : dir, textAlign: ltr ? 'left' : textStart(lang) }} />
  );

  const renderRow = (f: ParsedFamily) => {
    const r = results.get(f.familyKey);
    const d = state.decisions[f.familyKey];
    const isDone = isDecisionValid(d);
    const pick = pickOf(f, r);
    const sib = siblings(f);
    const draft = decisionOf(pick, r);
    return (
      <View key={f.familyKey} style={{ flexDirection: 'row', gap: 16, padding: 14, borderRadius: 12, borderWidth: selected === f.familyKey ? 2 : 1, borderColor: selected === f.familyKey ? k.tekhelet : k.line, backgroundColor: k.surface, opacity: isDone ? 0.78 : 1, minHeight: 52 }}>
        <View style={{ width: 190, gap: 6 }}>
          <Mono text={f.displayName} />
          <Txt size="small">{t('seatEditor.match.seats', { n: f.seats.length })}</Txt>
          <Txt size="caption" color={k.muted}>{whereText(f)}</Txt>
          <Button kind="secondary" title={t('seatEditor.match.showMap')} onPress={() => setSelected(f.familyKey)} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {isDone ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Tag label={t('seatEditor.match.confirmed')} tone="strong" />
              <Txt content style={{ flexShrink: 1 }}>{describe(d!)}</Txt>
              <Button kind="secondary" title={t('seatEditor.match.change')} onPress={() => { dispatch({ type: 'clear', key: f.familyKey }); setSelected(f.familyKey); }} />
            </View>
          ) : (
            <>
              {r?.candidates.map((c, i) => (
                <Radio key={`${c.kind}:${c.id}`} on={pick.opt === `c:${i}`} onPress={() => { setPick(f, r, { opt: `c:${i}` }); setSelected(f.familyKey); }}
                  label={`${labelOf(c.kind, c.id)}${c.kind === 'holder' ? ` · ${t('seatEditor.match.noAccount')}` : ''}`} sub={`${c.whyText}${c.holdsSeats && c.kind === 'family' ? ` · ${t('seatEditor.match.holdsSeats')}` : ''}`} />
              ))}
              {r?.ambiguous ? <Txt size="caption" color={k.gold}>{t('seatEditor.match.ambiguous')}</Txt> : null}
              <Radio on={pick.opt === 'new'} onPress={() => { setPick(f, r, { opt: 'new' }); setSelected(f.familyKey); }} label={t('seatEditor.match.optNew')} sub={r && r.candidates.length ? undefined : t('seatEditor.match.noneFound')} />
              {pick.opt === 'new' ? (
                <View style={{ gap: 6, paddingStart: 30, paddingBottom: 6 }}>
                  {nameInput(pick.name, (v) => setPick(f, r, { name: v }), t('seatEditor.match.holderName'), undefined, false, !pick.name.trim())}
                  {nameInput(pick.phone, (v) => setPick(f, r, { phone: v }), t('seatEditor.match.holderPhone'), t('seatEditor.match.holderPhoneHint'), true, !!pick.phone.trim() && !!draft && !isDecisionValid(draft))}
                </View>
              ) : null}
              <Radio on={pick.opt === 'link'} onPress={() => { setPick(f, r, { opt: 'link' }); setSelected(f.familyKey); }} label={t('seatEditor.match.optLink')} />
              {pick.opt === 'link' ? (
                <View style={{ paddingStart: 30, paddingBottom: 6 }}>
                  <PickList query={pick.query} onQuery={(v) => setPick(f, r, { query: v })} placeholder={t('seatEditor.match.searchFamily')} state="ready" empty={t('seatEditor.match.noFamilies')}
                    rows={families.filter((x) => !pick.query.trim() || normalizeName(`${x.lastName} ${x.firstName ?? ''} ${x.spouseFirstName ?? ''}`).includes(normalizeName(pick.query))).map((x) => ({ id: x.id, title: labelOf('family', x.id) }))}
                    selected={pick.link} onSelect={(id) => setPick(f, r, { link: id })} max={5} />
                </View>
              ) : null}
              <Radio on={pick.opt === 'skip'} onPress={() => { setPick(f, r, { opt: 'skip' }); setSelected(f.familyKey); }} label={t('seatEditor.match.optSkip')} sub={t('seatEditor.match.optSkipHelp')} />
              {sib.length ? <Txt size="caption" color={k.muted}>{t('seatEditor.match.sibling', { name: sib[0]!.displayName })}</Txt> : null}
              <View style={{ alignSelf: 'flex-start', paddingTop: 4 }}>
                <Button title={t('seatEditor.match.confirm')} disabled={!draft || !isDecisionValid(draft)} onPress={() => dispatch({ type: 'decide', key: f.familyKey, decision: draft! })} />
              </View>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderTwo = (c: (typeof twos)[number]) => {
    const key = cellKey(c.row, c.col);
    const choice = state.cells[key];
    const opts: { choice: CellChoice; label: string }[] = [
      ...c.parts.slice(0, 3).flatMap((p, i) => (p?.kind === 'seat' ? [{ choice: (['a', 'b', 'c'] as const)[i]!, label: t('seatEditor.match.seatOf', { name: p.displayName }) }] : [])),
      { choice: 'free', label: t('seatEditor.match.markFree') },
    ];
    return (
      <View key={key} style={{ gap: 4, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: choice ? k.line : k.gold, borderStartWidth: 5, backgroundColor: k.surface }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Mono text={c.raw} />
          <Txt size="small" color={k.muted}>{`${t('seatEditor.match.twoNames')} · ${rowText(parsed, c.row)}`}</Txt>
          {choice ? <Tag label={t('seatEditor.match.confirmed')} tone="strong" /> : null}
        </View>
        {opts.map((o) => <Radio key={o.choice} on={choice === o.choice} label={o.label} onPress={() => dispatch({ type: 'cell', row: c.row, col: c.col, choice: o.choice })} />)}
        <Txt size="caption" color={k.muted}>{t('seatEditor.match.twoNamesHelp')}</Txt>
      </View>
    );
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('seatEditor.match.f.all', { n: counts.all }) }, { key: 'todo', label: t('seatEditor.match.f.todo', { n: counts.todo }) },
    { key: 'exact', label: t('seatEditor.match.f.exact', { n: counts.exact }) }, { key: 'likely', label: t('seatEditor.match.f.likely', { n: counts.likely }) },
    { key: 'none', label: t('seatEditor.match.f.none', { n: counts.none }) }, { key: 'check', label: t('seatEditor.match.f.check', { n: counts.check }) },
  ];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: k.surface, borderBottomWidth: 1, borderBottomColor: k.line, flexWrap: 'wrap' }}>
        <Button kind="secondary" title={t('seatEditor.match.back')} onPress={onBack} />
        <View style={{ flex: 1 }} />
        <View accessibilityLiveRegion="polite"><Txt bold color={left ? k.gold : k.olive}>{left ? t('seatEditor.match.left', { n: left, total: dc.all }) : t('seatEditor.match.allDone')}</Txt></View>
        <Button title={t('seatEditor.match.save')} disabled={left > 0} onPress={onSave} accessibilityLabel={left ? `${t('seatEditor.match.save')}. ${t('seatEditor.match.left', { n: left, total: dc.all })}` : undefined} />
      </View>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Txt size="small" color={k.muted}>{t('seatEditor.match.lead')}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {filters.map((f) => <Chip key={f.key} size="filter" label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />)}
            <View style={{ minWidth: 200, flexShrink: 1 }}>{nameInput(query, setQuery, t('seatEditor.match.search'))}</View>
          </View>
          {bulkKeys.length ? (
            <View style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: k.olive, borderStartWidth: 6, backgroundColor: k.surface }}>
              <Txt>{t('seatEditor.match.bulk', { n: bulkKeys.length })}</Txt>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Button kind="secondary" title={t('seatEditor.match.bulkShow', { n: bulkKeys.length })} onPress={() => { setShowExact((v) => !v); setFilter('exact'); }} />
                <Button title={t('seatEditor.match.bulkConfirm', { n: bulkKeys.length })} disabled={!showExact && filter !== 'exact'} onPress={() => dispatch({ type: 'merge', decisions: bulk })} />
              </View>
              {!showExact && filter !== 'exact' ? <Txt size="caption" color={k.muted}>{t('seatEditor.match.bulkSeeFirst')}</Txt> : null}
            </View>
          ) : null}
          {showTwos.map(renderTwo)}
          {visible.map(renderRow)}
          {!visible.length && !showTwos.length ? <Txt color={k.muted}>{t('seatEditor.match.empty')}</Txt> : null}
        </ScrollView>
        <ScrollView style={{ width: 420, flexGrow: 0, flexShrink: 0, backgroundColor: k.surface, borderStartWidth: 1, borderStartColor: k.line }} contentContainerStyle={{ padding: 18, gap: 12 }}>
          {sel ? (
            <>
              <Txt serif size="heading" content accessibilityRole="header">{t('seatEditor.match.onMap', { name: sel.displayName })}</Txt>
              <Txt size="small" color={k.muted}>{`${t('seatEditor.match.seats', { n: sel.seats.length })} · ${whereText(sel)}`}</Txt>
              <Banner text={t('seatEditor.match.litHelp')} />
              <HallMini parsed={parsed} cells={state.cells} blockNames={blockNames} size={14} lit={lit} />
              {whyCandidate ? (
                <Card>
                  <Txt bold>{t('seatEditor.match.why')}</Txt>
                  <Txt content>{labelOf(whyCandidate.kind, whyCandidate.id)}</Txt>
                  <Txt size="small" color={k.muted}>{whyCandidate.whyText}</Txt>
                </Card>
              ) : null}
            </>
          ) : <Txt color={k.muted}>{t('seatEditor.match.pickRow')}</Txt>}
        </ScrollView>
      </View>
    </View>
  );
}
