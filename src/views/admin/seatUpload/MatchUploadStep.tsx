// Step 3 of the responses upload (UX-DESIGN §16.6, frame P27): every answer of the week gets a household, registered or without an
// account, or is skipped. Nothing is matched without a gabbai's confirmation; exact matches are confirmed together after the list is shown.
import React from 'react';
import { TextInput, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { textStart } from '../../../i18n/direction.ts';
import { Banner, Button, Chip, PickList, Tag, Txt, useTokens } from '../../../kit/components.tsx';
import { exactDecisions, isDecisionValid } from '../../../seats/decisions.ts';
import type { Decision, MatchAction, MatchState } from '../../../seats/decisions.ts';
import type { FormAnswer } from '../../../seats/formCsv.ts';
import { AREAS } from '../../../seats/formCsv.ts';
import { normalizeName } from '../../../seats/match.ts';
import type { MatchResult } from '../../../seats/match.ts';
import { Mono, Radio } from '../seatEditor/bits.tsx';

type Pick = { opt: string; link: string | null; query: string };
type Filter = 'all' | 'todo' | 'exact' | 'likely' | 'none';

export type Household = { ref: string; label: string; noAccount: boolean; search: string };

export function MatchUploadStep({ answers, results, state, dispatch, households, labelOf, onBack, onNext }: {
  answers: FormAnswer[]; results: Map<string, MatchResult>; state: MatchState; dispatch: React.Dispatch<MatchAction>;
  /** Every household a gabbai may link to by hand: registered families and holders. */
  households: Household[]; labelOf: (kind: 'family' | 'holder', id: string) => string; onBack: () => void; onNext: () => void;
}) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');
  const [showExact, setShowExact] = React.useState(false);
  const [picks, setPicks] = React.useState<Record<string, Pick>>({});
  const key = (a: FormAnswer) => normalizeName(a.name);
  const decided = (a: FormAnswer) => isDecisionValid(state.decisions[key(a)]);
  const left = answers.filter((a) => !decided(a)).length;
  const category = (a: FormAnswer): Filter => { const r = results.get(key(a)); return r?.level === 'exact' ? 'exact' : r?.level === 'likely' ? 'likely' : 'none'; };
  const counts: Record<Filter, number> = {
    all: answers.length, todo: left,
    exact: answers.filter((a) => category(a) === 'exact').length, likely: answers.filter((a) => category(a) === 'likely').length, none: answers.filter((a) => category(a) === 'none').length,
  };
  const bulk = React.useMemo(() => exactDecisions([...results.values()], state), [results, state]);
  const bulkKeys = Object.keys(bulk).filter((x) => answers.some((a) => key(a) === x));
  const q = normalizeName(query);
  const visible = answers.filter((a) => {
    if (q && !normalizeName(a.name).includes(q)) return false;
    if (filter === 'todo') return !decided(a);
    return filter === 'all' || category(a) === filter;
  });

  const pickOf = (a: FormAnswer, r: MatchResult | undefined): Pick => picks[key(a)] ?? { opt: r && r.candidates.length === 1 ? 'c:0' : '', link: null, query: '' };
  const setPick = (a: FormAnswer, r: MatchResult | undefined, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [key(a)]: { ...pickOf(a, r), ...patch } }));
  const decisionOf = (p: Pick, r: MatchResult | undefined): Decision | null => {
    if (p.opt.startsWith('c:')) { const c = r?.candidates[Number(p.opt.slice(2))]; return c ? (c.kind === 'family' ? { kind: 'family', id: c.id } : { kind: 'holder', id: c.id }) : null; }
    if (p.opt === 'link' && p.link) { const [kind, id] = p.link.split(':') as ['family' | 'holder', string]; return { kind, id }; }
    if (p.opt === 'skip') return { kind: 'skip' };
    return null;
  };
  const describe = (d: Decision) => (d.kind === 'family' || d.kind === 'holder' ? labelOf(d.kind, d.id) : t('seatUpload.match.skipped'));
  const summary = (a: FormAnswer) => {
    const parts: string[] = [];
    if (a.counts.erev !== undefined || a.counts.day !== undefined) parts.push(t('seatUpload.match.counts', { erev: a.counts.erev ?? 0, day: a.counts.day ?? 0 }));
    for (const area of AREAS) if (a.requests[area]) parts.push(t('seatUpload.match.request', { n: a.requests[area]!, area }));
    return parts.join(' · ') || t('seatUpload.match.noCounts');
  };

  const renderRow = (a: FormAnswer) => {
    const r = results.get(key(a));
    const d = state.decisions[key(a)];
    const done = isDecisionValid(d);
    const pick = pickOf(a, r);
    const draft = decisionOf(pick, r);
    const linkRows = households.filter((h) => !pick.query.trim() || h.search.includes(normalizeName(pick.query))).map((h) => ({ id: h.ref, title: h.noAccount ? `${h.label} · ${t('seatEditor.match.noAccount')}` : h.label }));
    return (
      <View key={key(a)} style={{ flexDirection: 'row', gap: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface, opacity: done ? 0.78 : 1, minHeight: 52, flexWrap: 'wrap' }}>
        <View style={{ width: 230, gap: 4 }}>
          <Mono text={a.name} />
          <Txt size="small">{summary(a)}</Txt>
          {a.earlier ? <Txt size="caption" color={k.muted}>{t('seatUpload.match.earlier', { n: a.earlier + 1 })}</Txt> : null}
        </View>
        <View style={{ flex: 1, minWidth: 260, gap: 2 }}>
          {done ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Tag label={t('seatEditor.match.confirmed')} tone="strong" />
              <Txt content style={{ flexShrink: 1 }}>{describe(d!)}</Txt>
              <Button kind="secondary" title={t('seatEditor.match.change')} onPress={() => dispatch({ type: 'clear', key: key(a) })} />
            </View>
          ) : (
            <>
              {r?.candidates.map((c, i) => (
                <Radio key={`${c.kind}:${c.id}`} on={pick.opt === `c:${i}`} onPress={() => setPick(a, r, { opt: `c:${i}` })}
                  label={`${labelOf(c.kind, c.id)}${c.kind === 'holder' ? ` · ${t('seatEditor.match.noAccount')}` : ''}`}
                  sub={`${c.whyText}${c.kind === 'family' && !c.holdsSeats ? ` · ${t('seatUpload.match.noSeats')}` : ''}`} />
              ))}
              {r?.ambiguous ? <Txt size="caption" color={k.gold}>{t('seatEditor.match.ambiguous')}</Txt> : null}
              {!r?.candidates.length ? <Txt size="small" color={k.muted}>{t('seatUpload.match.none')}</Txt> : null}
              <Radio on={pick.opt === 'link'} onPress={() => setPick(a, r, { opt: 'link' })} label={t('seatEditor.match.optLink')} />
              {pick.opt === 'link' ? (
                <View style={{ paddingStart: 30, paddingBottom: 6 }}>
                  <PickList query={pick.query} onQuery={(v) => setPick(a, r, { query: v })} placeholder={t('seatEditor.match.searchFamily')} state="ready" empty={t('seatEditor.match.noFamilies')}
                    rows={linkRows} selected={pick.link} onSelect={(id) => setPick(a, r, { link: id })} max={5} />
                </View>
              ) : null}
              <Radio on={pick.opt === 'skip'} onPress={() => setPick(a, r, { opt: 'skip' })} label={t('seatUpload.match.optSkip')} sub={t('seatUpload.match.optSkipHelp')} />
              <View style={{ alignSelf: 'flex-start', paddingTop: 4 }}>
                <Button title={t('seatEditor.match.confirm')} disabled={!draft || !isDecisionValid(draft)} onPress={() => dispatch({ type: 'decide', key: key(a), decision: draft! })} />
              </View>
            </>
          )}
        </View>
      </View>
    );
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('seatEditor.match.f.all', { n: counts.all }) }, { key: 'todo', label: t('seatEditor.match.f.todo', { n: counts.todo }) },
    { key: 'exact', label: t('seatEditor.match.f.exact', { n: counts.exact }) }, { key: 'likely', label: t('seatEditor.match.f.likely', { n: counts.likely }) },
    { key: 'none', label: t('seatEditor.match.f.none', { n: counts.none }) },
  ];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button kind="secondary" title={t('seatUpload.back')} onPress={onBack} />
        <View style={{ flex: 1 }} />
        <View accessibilityLiveRegion="polite"><Txt bold color={left ? k.gold : k.olive}>{left ? t('seatEditor.match.left', { n: left, total: answers.length }) : t('seatEditor.match.allDone')}</Txt></View>
        <Button title={t('seatUpload.match.next')} disabled={left > 0} onPress={onNext} />
      </View>
      <Txt size="small" color={k.muted}>{t('seatUpload.match.lead')}</Txt>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {filters.map((f) => <Chip key={f.key} size="filter" label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />)}
        <View style={{ minWidth: 200, flexShrink: 1 }}>
          <TextInput accessibilityLabel={t('seatEditor.match.search')} placeholder={t('seatEditor.match.search')} placeholderTextColor={k.muted} value={query} onChangeText={setQuery}
            style={{ minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: 16, writingDirection: dir, textAlign: textStart(lang) }} />
        </View>
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
      {visible.map(renderRow)}
      {!visible.length ? <Txt color={k.muted}>{t('seatEditor.match.empty')}</Txt> : null}
      <Banner text={t('seatUpload.match.requestOnly')} />
    </View>
  );
}
