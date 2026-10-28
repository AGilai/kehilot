// The gabbai's prayer-schedule editor (UX-DESIGN §14.2, frame P20): sections and rows on one side, a live preview of the draft on the
// other, a formula builder that reads as a sentence, "this week only" edits, explicit Save. Gabbaim only (Main gates the route).
// All logic is in src/schedule/editor.ts (pure, tested); this file wires it to the API and the screen.
import React from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { fixtureNow } from '../../client/fixtures.ts';
import { ApiCodeError } from '../../client/errors.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { BackIcon } from '../../kit/Icon.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import {
  applyFormulaPatch, changeCount, classicSections, cleanSections, editorReducer, initialEditorState, isDirty, issueTarget, nextId,
  overrideIssueTarget, rebaseDraft, saveDiff, sectionItems, takenIds, validateSections, validateWeekOverrides, weekChanges, weekEditable, weekList, timeOfKind,
} from '../../schedule/editor.ts';
import type { Draft, FormulaPatch, Issue, IssueControl, RowItem } from '../../schedule/editor.ts';
import { fullModel, textIn } from '../../schedule/memberView.ts';
import { openPrintPage, sharePdf } from '../../schedule/printSheet.ts';
import { buildSheet } from '../../schedule/sheetSource.ts';
import type { Formula, Schedule, ScheduleDoc, Section, Text, Time } from '../../schedule/types.ts';
import { computeWeek, israelNow, scheduleWeekOf } from '../../schedule/week.ts';
import { zmanimForLocation } from '../../schedule/zmanim.ts';
import { clockLabel } from '../../schedule/memberView.ts';
import { useLogoUri } from '../SchedulePrint.tsx';
import { FormulaBuilder, WeekOnlyBox } from './scheduleEditor/FormulaBuilder.tsx';
import { ActionMenu } from './scheduleEditor/controls.tsx';
import type { Key } from './scheduleEditor/controls.tsx';
import { Preview } from './scheduleEditor/Preview.tsx';
import type { PreviewMode } from './scheduleEditor/Preview.tsx';
import { SectionCard, itemKey } from './scheduleEditor/Sections.tsx';
import { WeekPicker } from './scheduleEditor/WeekPicker.tsx';
import { WIDE, useAdminErrText } from './shared.tsx';
import { isManagement } from '../../client/roles.ts';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; doc: ScheduleDoc };
type Shown = { week?: string; sectionId: string | null; rowId: string | null; extraId: string | null; control: IssueControl; message: string };

const EMPTY = { sections: [], weekOverrides: {}, updatedAt: null as number | null };
const ltr = (value: string) => `⁦${value}⁩`;

export function ScheduleEditor({ onBack, onDirty, onToast }: { onBack: () => void; onDirty: (dirty: boolean) => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const session = useSession();
  const errText = useAdminErrText();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const kehilaId = session.state.kehilaId;
  const managing = isManagement(session.state.kehila?.role);
  const logo = useLogoUri();

  const today = React.useMemo(() => israelNow(fixtureNow() ?? new Date()).date, []);
  const weeks = React.useMemo(() => weekList(today, 9), [today]);
  const [friday, setFriday] = React.useState(() => (weeks.find(w => w.upcoming) ?? weeks[0]!).friday);
  const week = React.useMemo(() => scheduleWeekOf(friday), [friday]);

  const [load, setLoad] = React.useState<Load>({ status: 'loading' });
  const [state, dispatch] = React.useReducer(editorReducer, EMPTY, initialEditorState);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const base = load.status === 'ready' ? load.doc : null;

  const fetchDoc = React.useCallback(async () => {
    if (!kehilaId) return;
    setLoad({ status: 'loading' });
    try {
      const doc = await api.schedule(kehilaId);
      dispatch({ type: 'reset', doc });
      setLoad({ status: 'ready', doc });
    } catch { setLoad({ status: 'error' }); }
  }, [api, kehilaId]);
  React.useEffect(() => { void fetchDoc(); }, [fetchDoc]);

  const dirty = isDirty(state);
  const count = changeCount(state);
  React.useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ---- derived -------------------------------------------------------------------------------------------------------------
  const { draft } = state;
  const zmanimFor = React.useMemo(() => zmanimForLocation(base?.location), [base]);
  const schedule: Schedule = React.useMemo(() => ({ version: 1, sections: draft.sections, weekOverrides: draft.weekOverrides }), [draft]);
  const computed = React.useMemo(() => computeWeek(schedule, friday, zmanimFor), [schedule, friday, zmanimFor]);
  const previewDoc: ScheduleDoc | null = React.useMemo(() => (base ? { ...base, ...schedule } : null), [base, schedule]);
  const editable = weekEditable(friday, today);
  const overrides = draft.weekOverrides[friday];
  const changes = React.useMemo(() => Object.fromEntries(Object.entries(draft.weekOverrides).map(([f, w]) => [f, weekChanges(w)])), [draft.weekOverrides]);
  const itemsOf = React.useCallback((section: Section, index: number) => sectionItems(section, overrides, computed.sections[index]), [overrides, computed]);

  // ---- ui state ------------------------------------------------------------------------------------------------------------
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [review, setReview] = React.useState<Set<string>>(new Set());
  const [started, setStarted] = React.useState(false);
  const [mode, setMode] = React.useState<PreviewMode>('phone');
  const [narrowTab, setNarrowTab] = React.useState<'edit' | 'preview'>('edit');
  const [pendingDelete, setPendingDelete] = React.useState<RowItem | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [announce, setAnnounce] = React.useState('');
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const rowRefs = React.useRef(new Map<string, unknown>());
  const snapshot = React.useRef<Draft | null>(null);

  const allItems = React.useMemo(() => draft.sections.flatMap((s, i) => (collapsed.has(s.id) ? [] : itemsOf(s, i).map(item => ({ item, section: s })))), [draft.sections, collapsed, itemsOf]);
  const selected = allItems.find(x => itemKey(x.item) === selectedKey) ?? null;
  const rovingKey = selectedKey && selected ? selectedKey : focusKey && allItems.some(x => itemKey(x.item) === focusKey) ? focusKey : allItems[0] ? itemKey(allItems[0].item) : null;

  const focusRow = (key: string) => { setFocusKey(key); setTimeout(() => (rowRefs.current.get(key) as { focus?: () => void } | undefined)?.focus?.(), 0); };
  const open = (key: string | null) => {
    if (key && key.startsWith('row:')) setReview(r => { if (!r.has(key.slice(4))) return r; const n = new Set(r); n.delete(key.slice(4)); return n; });
    if (key && !wide) snapshot.current = stateRef.current.draft;
    setSelectedKey(key);
    if (key) setFocusKey(key);
  };

  // ---- errors --------------------------------------------------------------------------------------------------------------
  const [problems, setProblems] = React.useState<Shown[]>([]);
  const [banner, setBanner] = React.useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const issueText = (issue: Issue) => t(`editor.issue.${issue.code}`, { limit: issue.limit ?? 0 });
  const errorsFor = (rowId: string | null, extraId: string | null): Partial<Record<IssueControl, string>> => {
    const out: Partial<Record<IssueControl, string>> = {};
    for (const p of problems) if ((rowId && p.rowId === rowId) || (extraId && p.extraId === extraId)) out[p.control] = p.message;
    return out;
  };
  React.useEffect(() => { if (problems.length) setProblems([]); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Marks problems on their rows and opens the first one. */
  const showProblems = (list: Shown[]) => {
    setProblems(list);
    const first = list.find(p => p.rowId || p.extraId);
    if (first) {
      if (first.week) setFriday(first.week);
      if (first.sectionId) setCollapsed(c => { const n = new Set(c); n.delete(first.sectionId!); return n; });
      open(first.rowId ? `row:${first.rowId}` : `extra:${first.extraId}`);
    }
  };

  // ---- saving --------------------------------------------------------------------------------------------------------------
  async function save() {
    if (busy || !kehilaId || load.status !== 'ready') return;
    setBanner(null); setConflict(false);
    const cleaned: Draft = { sections: cleanSections(stateRef.current.draft.sections), weekOverrides: stateRef.current.draft.weekOverrides };
    dispatch({ type: 'restore', draft: cleaned });
    const diff = saveDiff(stateRef.current.saved, cleaned);
    const list: Shown[] = [];
    const sectionIssues = diff.sections ? validateSections(cleaned.sections) : [];
    for (const issue of sectionIssues) { const at = issueTarget(issue.path, cleaned.sections); list.push({ ...at, extraId: null, message: issueText(issue) }); }
    for (const w of diff.weeks) {
      if (!w.overrides) continue;
      for (const issue of validateWeekOverrides(w.overrides)) { const at = overrideIssueTarget(issue.path, w.overrides); list.push({ week: w.friday, sectionId: null, rowId: at.rowId, extraId: at.extraId, control: at.control, message: issueText(issue) }); }
    }
    if (list.length) {
      showProblems(list);
      setBanner({ tone: 'error', text: !list.some(p => p.rowId || p.extraId) ? list[0]!.message : t('editor.fixFirst', { n: list.length }) });
      return;
    }
    setBusy(true);
    let savedSnap: Draft = stateRef.current.saved;
    let updatedAt = stateRef.current.updatedAt;
    let weekInFlight: string | null = null;
    try {
      if (diff.sections) {
        const res = await api.putSchedule(kehilaId, { sections: cleaned.sections, ifUpdatedAt: updatedAt });
        updatedAt = res.updatedAt;
        savedSnap = { ...savedSnap, sections: cleaned.sections };
        dispatch({ type: 'saved', snapshot: savedSnap, updatedAt });
      }
      for (const w of diff.weeks) {
        weekInFlight = w.friday;
        if (w.overrides) await api.putScheduleWeek(kehilaId, w.friday, w.overrides); else await api.deleteScheduleWeek(kehilaId, w.friday);
        const next = { ...savedSnap.weekOverrides };
        if (w.overrides) next[w.friday] = w.overrides; else delete next[w.friday];
        savedSnap = { ...savedSnap, weekOverrides: next };
        dispatch({ type: 'saved', snapshot: savedSnap, updatedAt });
      }
      onToast(t('editor.saved'));
    } catch (e) {
      const err = e instanceof ApiCodeError ? e : null;
      if (err?.code === 'schedule_changed') setConflict(true);
      else if (err?.field && (err.code === 'invalid_schedule' || err.code === 'invalid_overrides')) {
        const at = err.code === 'invalid_schedule' ? { ...issueTarget(err.field, cleaned.sections), extraId: null as string | null } : { sectionId: null, ...overrideIssueTarget(err.field, cleaned.weekOverrides[weekInFlight ?? friday] ?? {}) };
        showProblems([{ week: err.code === 'invalid_overrides' ? weekInFlight ?? undefined : undefined, sectionId: at.sectionId, rowId: at.rowId, extraId: at.extraId, control: at.control, message: errText(e) }]);
        setBanner({ tone: 'error', text: errText(e) });
      } else setBanner({ tone: 'error', text: errText(e) });
    } finally { setBusy(false); }
  }
  /** 409, "keep mine": load the server copy and put my unsaved changes back on top of it as unsaved changes. */
  async function reloadKeepingMine() {
    if (!kehilaId) return;
    const { saved, draft: mine } = stateRef.current;
    setConflict(false);
    try {
      const doc = await api.schedule(kehilaId);
      dispatch({ type: 'reset', doc });
      setLoad({ status: 'ready', doc });
      dispatch({ type: 'restore', draft: rebaseDraft(saved, mine, { sections: doc.sections, weekOverrides: doc.weekOverrides }) });
      setBanner({ tone: 'info', text: t('editor.conflictMerged') });
    } catch (e) { setBanner({ tone: 'error', text: errText(e) }); }
  }
  const saveRef = React.useRef(save);
  saveRef.current = save;

  // ---- keyboard: Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes the draft (not inside a text field, which has its own undo) -------------------
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current(); }
      else if (e.key.toLowerCase() === 'z' && !e.shiftKey && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); dispatch({ type: 'undo' }); setAnnounce(t('editor.undone')); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [t]);

  // ---- actions -------------------------------------------------------------------------------------------------------------
  const rowName = (item: RowItem) => textIn(item.kind === 'row' ? item.row.label : item.extra.label, lang) || t('editor.rowFallback');
  const deleteItem = (item: RowItem) => {
    dispatch(item.kind === 'row' ? { type: 'deleteRow', rowId: item.row.id } : { type: 'deleteExtra', friday, id: item.extra.id });
    if (selectedKey === itemKey(item)) setSelectedKey(null);
    setPendingDelete(null);
    setAnnounce(t('editor.deleted', { row: rowName(item) }));
  };
  const addRow = (section: Section, what: 'row' | 'text' | 'week') => {
    setStarted(true);
    const taken = takenIds(draft);
    const last = section.rows[section.rows.length - 1]?.id ?? null;
    if (what === 'week') {
      const id = nextId('x', taken);
      dispatch({ type: 'addExtra', friday, extra: { id, sectionId: section.id, afterRowId: last, label: { he: t('editor.newExtra') }, time: { kind: 'none' } } });
      setNewKey(`extra:${id}`); open(`extra:${id}`);
      return;
    }
    const id = nextId('r', taken);
    dispatch({ type: 'addRow', sectionId: section.id, id, label: { he: t(what === 'text' ? 'editor.newText' : 'editor.newRow') }, time: what === 'text' ? { kind: 'none' } : undefined });
    setCollapsed(c => { const n = new Set(c); n.delete(section.id); return n; });
    setNewKey(`row:${id}`); open(`row:${id}`);
  };
  const addSection = (kind: Section['kind']) => {
    setStarted(true);
    const id = nextId('sec', takenIds(draft));
    dispatch({ type: 'addSection', id, kind, title: { he: t(kind === 'shabbat' ? 'editor.newShabbatSection' : 'editor.newWeekdaySection') } });
  };
  const startClassic = () => {
    const sections = classicSections();
    dispatch({ type: 'restore', draft: { sections, weekOverrides: draft.weekOverrides } });
    setReview(new Set(sections.flatMap(s => s.rows.map(r => r.id))));
    setStarted(true);
  };
  const moveRow = (item: RowItem, delta: number) => {
    if (item.kind !== 'row') return;
    const section = draft.sections.find(s => s.rows.some(r => r.id === item.row.id))!;
    const from = section.rows.findIndex(r => r.id === item.row.id);
    const to = Math.min(section.rows.length - 1, Math.max(0, from + delta));
    dispatch({ type: 'moveRow', rowId: item.row.id, delta });
    if (to !== from) setAnnounce(t('editor.moved', { row: rowName(item), n: to + 1, total: section.rows.length }));
    focusRow(itemKey(item));
  };
  const onAction = (item: RowItem, action: 'duplicate' | 'up' | 'down' | 'hide' | 'show' | 'delete') => {
    if (action === 'delete') setPendingDelete(item);
    else if (action === 'up' || action === 'down') moveRow(item, action === 'up' ? -1 : 1);
    else if (item.kind === 'row') {
      if (action === 'hide') dispatch({ type: 'setOverride', friday, rowId: item.row.id, override: { kind: 'hide' } });
      else if (action === 'show') dispatch({ type: 'setOverride', friday, rowId: item.row.id, override: null });
      else if (action === 'duplicate') { const id = nextId('r', takenIds(draft)); dispatch({ type: 'duplicateRow', rowId: item.row.id, id }); setNewKey(`row:${id}`); open(`row:${id}`); }
    }
  };
  const onRowKey = (item: RowItem, key: Key) => {
    const keys = allItems.map(x => itemKey(x.item));
    const me = itemKey(item);
    const at = keys.indexOf(me);
    if (key.alt && key.shift && (key.key === 'ArrowUp' || key.key === 'ArrowDown')) {
      key.prevent();
      const section = allItems[at]?.section;
      if (section) dispatch({ type: 'moveSection', id: section.id, delta: key.key === 'ArrowUp' ? -1 : 1 });
    } else if (key.alt && (key.key === 'ArrowUp' || key.key === 'ArrowDown')) { key.prevent(); moveRow(item, key.key === 'ArrowUp' ? -1 : 1); }
    else if (key.key === 'ArrowUp' || key.key === 'ArrowDown') {
      key.prevent();
      const next = keys[at + (key.key === 'ArrowUp' ? -1 : 1)];
      if (next) focusRow(next);
    } else if (key.key === 'Enter' || key.key === ' ') { key.prevent(); open(selectedKey === me ? null : me); }
    else if (key.key === 'Escape') { key.prevent(); open(null); focusRow(me); }
    else if (key.key === 'Delete') { key.prevent(); setPendingDelete(item); }
  };
  const hideForWeek = (rowId: string, added: boolean) => {
    if (!editable) return;
    dispatch(added ? { type: 'deleteExtra', friday, id: rowId } : { type: 'setOverride', friday, rowId, override: { kind: 'hide' } });
  };

  // ---- drag -----------------------------------------------------------------------------------------------------------------
  const dragRow = React.useRef<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [over, setOver] = React.useState<string | null>(null);
  const drag = {
    active: dragging, over,
    start: (rowId: string) => { dragRow.current = rowId; setDragging(true); },
    end: () => { dragRow.current = null; setDragging(false); setOver(null); },
    hover: (key: string | null) => setOver(key),
    drop: (sectionId: string, index: number) => {
      const rowId = dragRow.current;
      dragRow.current = null; setDragging(false); setOver(null);
      if (rowId) dispatch({ type: 'moveRowTo', rowId, sectionId, index });
    },
  };

  // ---- sharing ---------------------------------------------------------------------------------------------------------------
  const printWeekIndex = React.useMemo((): 0 | 1 | null => {
    if (!base) return null;
    const now = israelNow(fixtureNow() ?? new Date());
    for (const index of [0, 1] as const) if (fullModel(schedule, now, zmanimFor, index).week.friday === friday) return index;
    return null;
  }, [base, schedule, zmanimFor, friday]);
  const [printing, setPrinting] = React.useState(false);
  async function printSheet() {
    if (printWeekIndex === null || !base) return;
    if (Platform.OS === 'web') { if (!openPrintPage(printWeekIndex)) setBanner({ tone: 'error', text: t('schedule.printError') }); return; }
    const kehila = session.state.kehila;
    if (!kehila) return;
    setPrinting(true);
    try { await sharePdf(buildSheet({ ...base, ...schedule }, computed, { kehilaName: kehila.name, logoUri: logo.uri, messages: Object.values(session.state.feed.messages) })); }
    catch { setBanner({ tone: 'error', text: t('schedule.printError') }); } finally { setPrinting(false); }
  }
  const soon = t('schedule.soon');
  const shareItems = [
    { key: 'square', label: t('editor.shareSquare'), icon: 'image' as const, onPress: () => {}, disabled: true, hint: soon },
    { key: 'a4', label: t('editor.shareA4'), icon: 'image' as const, onPress: () => {}, disabled: true, hint: soon },
    { key: 'pdf', label: t('editor.sharePdf'), icon: 'print' as const, onPress: () => { void printSheet(); }, disabled: dirty || printWeekIndex === null || printing },
    { key: 'notice', label: t('editor.shareNotice'), icon: 'image' as const, onPress: () => {}, disabled: true, hint: soon },
    { key: 'link', label: t('editor.shareLink'), icon: 'link' as const, onPress: () => {}, disabled: true, hint: soon },
  ];

  // ---- the builder for the selected row or extra ----------------------------------------------------------------------------
  const renderBuilder = (item: RowItem) => {
    const section = draft.sections.find(s => (item.kind === 'row' ? s.rows.some(r => r.id === item.row.id) : s.id === item.extra.sectionId));
    if (!section) return null;
    const key = itemKey(item);
    const close = () => { open(null); focusRow(key); };
    const shared = { sectionKind: section.kind, week, zmanimFor, narrow: !wide, onClose: close, autoFocusName: newKey === key } as const;
    if (item.kind === 'row') {
      const row = item.row;
      const usual = item.override?.kind === 'time' ? item.computed?.usual ?? null : item.computed?.time ?? null;
      return (
        <FormulaBuilder {...shared} label={row.label} note={row.note} time={row.time} day={row.day} candles={row.role === 'candles'} thisWeek={item.override?.kind === 'time'}
          errors={errorsFor(row.id, null)}
          onLabel={label => dispatch({ type: 'editRow', rowId: row.id, patch: { label }, key: `label:${row.id}` })}
          onNote={note => dispatch({ type: 'editRow', rowId: row.id, patch: { note }, key: `note:${row.id}` })}
          onKind={kind => dispatch({ type: 'setTimeKind', rowId: row.id, kind, at: item.computed?.time ?? undefined })}
          onFixed={at => dispatch({ type: 'setFixedTime', rowId: row.id, at, key: `time:${row.id}` })}
          onFormula={(patch: FormulaPatch) => dispatch({ type: 'setFormula', rowId: row.id, patch, key: `formula:${row.id}:${Object.keys(patch).join(',')}` })}
          onDay={day => dispatch({ type: 'editRow', rowId: row.id, patch: { day } })}
          onCandles={on => dispatch({ type: 'editRow', rowId: row.id, patch: { role: on ? 'candles' : null } })}
          weekBox={<WeekOnlyBox editable={editable} week={week} override={item.override} usual={usual} canTime={row.time.kind !== 'none'} error={!!errorsFor(row.id, null).time}
            onChange={override => dispatch({ type: 'setOverride', friday, rowId: row.id, override, key: `override:${row.id}` })} />}
          onDuplicate={() => onAction(item, 'duplicate')} onDelete={() => deleteItem(item)} />
      );
    }
    const extra = item.extra;
    const edit = (patch: Partial<Omit<typeof extra, 'id' | 'sectionId'>>, k2: string) => dispatch({ type: 'editExtra', friday, id: extra.id, patch, key: `${k2}:${extra.id}` });
    const baseFormula = (): Formula => (extra.time.kind === 'formula' ? extra.time.formula : (timeOfKind('formula', section.kind) as { formula: Formula }).formula);
    return (
      <FormulaBuilder {...shared} label={extra.label} note={extra.note} time={extra.time} day={extra.day} thisWeek errors={errorsFor(null, extra.id)}
        onLabel={label => edit({ label }, 'label')} onNote={note => edit({ note }, 'note')}
        onKind={kind => edit({ time: timeOfKind(kind, section.kind, item.computed?.time ?? undefined) as Time }, 'kind')}
        onFixed={at => edit({ time: { kind: 'fixed', at } }, 'time')}
        onFormula={patch => edit({ time: { kind: 'formula', formula: applyFormulaPatch(baseFormula(), patch) } }, 'formula')}
        onDay={day => edit({ day }, 'day')} onDelete={() => deleteItem(item)} />
    );
  };

  // ---- pieces of the page -----------------------------------------------------------------------------------------------------
  const summaryOf = (section: Section, index: number) => {
    const timed = itemsOf(section, index).filter(i => !(i.kind === 'row' && i.hidden) && i.computed?.time);
    if (!timed.length) return t('editor.rowCount', { n: section.rows.length });
    const pick = section.kind === 'shabbat' ? [timed[0]!, timed[timed.length - 1]!] : [timed[0]!, timed[timed.length - 1]!];
    return [...new Set(pick)].map(i => `${textIn(i.kind === 'row' ? i.row.label : i.extra.label, lang)} ${ltr(clockLabel(i.computed!.time!))}`).join(' · ');
  };
  const sections = (
    <View style={{ gap: 16 }}>
      {draft.sections.map((section, index) => (
        <SectionCard key={section.id} section={section} index={index} count={draft.sections.length} items={itemsOf(section, index)} overrideCount={editable || overrides ? itemsOf(section, index).filter(i => i.kind === 'extra' || (i.kind === 'row' && i.override)).length : 0}
          summary={summaryOf(section, index)} selectedKey={selectedKey} focusKey={rovingKey} review={review} collapsed={collapsed.has(section.id)} narrow={!wide} weekEditable={editable}
          renderBuilder={renderBuilder} rowRefs={rowRefs} drag={drag}
          onToggle={() => setCollapsed(c => { const n = new Set(c); if (n.has(section.id)) n.delete(section.id); else n.add(section.id); return n; })}
          onSelect={key => open(selectedKey === key && wide ? null : key)} onRowKey={onRowKey}
          onRename={title => dispatch({ type: 'renameSection', id: section.id, title, key: `section:${section.id}` })}
          onMoveSection={delta => dispatch({ type: 'moveSection', id: section.id, delta })}
          onDeleteSection={() => { dispatch({ type: 'deleteSection', id: section.id }); setSelectedKey(null); }}
          onAdd={what => addRow(section, what)} onAction={onAction} />
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button kind="secondary" icon="plus" title={t('editor.addShabbatSection')} onPress={() => addSection('shabbat')} disabled={draft.sections.length >= 12} />
        <Button kind="secondary" icon="plus" title={t('editor.addWeekdaySection')} onPress={() => addSection('weekday')} disabled={draft.sections.length >= 12} />
      </View>
    </View>
  );

  const emptyCard = (
    <Card edgeColor={k.tekhelet}>
      <Txt serif size="heading" accessibilityRole="header">{t('editor.emptyTitle')}</Txt>
      <Txt color={k.muted}>{t('editor.emptyBody')}</Txt>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button title={t('editor.startClassic')} onPress={startClassic} />
        <Button kind="secondary" title={t('editor.startBlank')} onPress={() => setStarted(true)} />
      </View>
    </Card>
  );
  const showEmpty = draft.sections.length === 0 && !started && state.updatedAt === null;

  const banners = (
    <View style={{ gap: 12 }}>
      {conflict ? (
        <View accessibilityRole="alert" style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: k.danger, borderStartWidth: 6, backgroundColor: k.surface }}>
          <Txt bold>{t('editor.conflictTitle')}</Txt>
          <Txt size="small">{t('editor.conflictBody')}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button kind="danger" title={t('editor.conflictReload')} onPress={() => { setConflict(false); setSelectedKey(null); void fetchDoc(); }} />
            <Button kind="secondary" title={t('editor.conflictKeep')} onPress={() => { void reloadKeepingMine(); }} />
          </View>
        </View>
      ) : null}
      {banner ? <Banner tone={banner.tone} text={banner.text} /> : null}
      {pendingDelete ? (
        <View accessibilityRole="alert" style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: k.danger, borderStartWidth: 6, backgroundColor: k.surface }}>
          <Txt bold>{t('editor.deleteAskNamed', { row: rowName(pendingDelete) })}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button kind="danger" title={t('editor.deleteYes')} onPress={() => deleteItem(pendingDelete)} />
            <Button kind="secondary" title={t('common.cancel')} onPress={() => setPendingDelete(null)} />
          </View>
        </View>
      ) : null}
      {confirmDiscard ? (
        <View accessibilityRole="alert" style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: k.danger, borderStartWidth: 6, backgroundColor: k.surface }}>
          <Txt bold>{t('editor.discardAsk', { n: count })}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button kind="danger" title={t('editor.discardYes')} onPress={() => { dispatch({ type: 'discard' }); setConfirmDiscard(false); setSelectedKey(null); setProblems([]); setBanner(null); }} />
            <Button kind="secondary" title={t('editor.discardKeep')} onPress={() => setConfirmDiscard(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );

  const saveButtons = (
    <>
      <Button kind="secondary" title={t('editor.discard')} disabled={!dirty || busy} onPress={() => setConfirmDiscard(true)} />
      <Button title={busy ? t('editor.saving') : t('editor.save')} accessibilityLabel={`${t('editor.save')}${dirty ? ` · ${count}` : ''}`} busy={busy} disabled={!dirty} onPress={() => { void save(); }} />
    </>
  );
  const shareMenu = (
    <View {...({ title: dirty ? t('editor.shareSaveFirst') : undefined } as object)}>
      <ActionMenu label={t('editor.share')} items={shareItems} width={280}
        trigger={openMenu => <Button kind="secondary" icon="share" title={t('editor.share')} disabled={dirty} onPress={openMenu} />} />
    </View>
  );
  const dirtyBadge = (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {dirty ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k.gold }} /> : null}
      <Txt size="small" color={dirty ? k.ink : k.muted}>{dirty ? t('editor.unsaved', { n: count }) : t('editor.allSaved')}</Txt>
    </View>
  );

  if (!managing || !kehilaId) return null;

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('editor.back')} onPress={onBack} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('editor.back')}</Txt></View>
    </Pressable>
  );
  const status = load.status === 'loading' ? <Card><Txt color={k.muted}>{t('common.loading')}</Txt></Card>
    : load.status === 'error' ? <Banner tone="error" text={t('editor.loadError')} action={{ title: t('common.retry'), onPress: () => { void fetchDoc(); } }} /> : null;
  const liveNote = <View accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}><Txt>{announce}</Txt></View>;

  const preview = previewDoc ? (
    <Preview doc={previewDoc} week={week} zmanimFor={zmanimFor} dirty={dirty} highlightId={selected?.item.kind === 'row' ? selected.item.row.id : selected?.item.kind === 'extra' ? selected.item.extra.id : undefined}
      kehilaName={session.state.kehila?.name ?? ''} logoUri={logo.uri} messages={Object.values(session.state.feed.messages)} mode={mode} onMode={setMode} onHide={hideForWeek} narrow={!wide} />
  ) : null;

  if (wide) {
    return (
      <View style={{ flex: 1 }}>
        {liveNote}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, backgroundColor: k.surface, borderBottomWidth: 1, borderBottomColor: k.line, minHeight: 56 }}>
          {back}
          <Txt serif size="heading" accessibilityRole="header">{t('editor.title')}</Txt>
          <View style={{ flex: 1 }} />
          <Txt size="small" color={k.muted}>{session.state.kehila?.name}</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: k.surface, borderBottomWidth: 1, borderBottomColor: k.line, zIndex: 20, flexWrap: 'wrap' }}>
          <WeekPicker weeks={weeks} friday={friday} changes={changes} onSelect={f => { setFriday(f); }} wide />
          <View style={{ flex: 1 }} />
          {dirtyBadge}
          {saveButtons}
          {shareMenu}
        </View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
            {status}
            {banners}
            {load.status === 'ready' ? (showEmpty ? emptyCard : sections) : null}
          </ScrollView>
          <ScrollView style={{ width: 600, flexGrow: 0, flexShrink: 0, backgroundColor: k.surface, borderStartWidth: 1, borderStartColor: k.line }} contentContainerStyle={{ flexGrow: 1 }}>{preview}</ScrollView>
        </View>
      </View>
    );
  }

  const sheetItem = selected && !wide ? selected.item : null;
  return (
    <View style={{ flex: 1 }}>
      {liveNote}
      <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {back}
        <Txt serif size="display" accessibilityRole="header">{t('editor.title')}</Txt>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: k.stone, borderWidth: 1, borderColor: k.line }}>
          {(['edit', 'preview'] as const).map(tab => (
            <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: narrowTab === tab }} onPress={() => setNarrowTab(tab)}
              style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: narrowTab === tab ? k.surface : 'transparent', borderWidth: 1, borderColor: narrowTab === tab ? k.tekhelet : 'transparent' }}>
              <Txt size="small" bold color={narrowTab === tab ? k.tekhelet : k.muted}>{t(tab === 'edit' ? 'editor.tabEdit' : 'editor.tabPreview')}</Txt>
            </Pressable>
          ))}
        </View>
        <View style={{ zIndex: 20 }}><WeekPicker weeks={weeks} friday={friday} changes={changes} onSelect={setFriday} wide={false} /></View>
        {status}
        {banners}
        {load.status === 'ready' ? (narrowTab === 'preview' ? preview : showEmpty ? emptyCard : sections) : null}
      </PadScroll>
      <View style={{ borderTopWidth: 1, borderTopColor: k.line, backgroundColor: k.surface, padding: 12, gap: 8 }}>
        {dirty ? dirtyBadge : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>{shareMenu}</View>
          <View style={{ flex: 2 }}><Button title={busy ? t('editor.saving') : dirty ? `${t('editor.save')} · ${count}` : t('editor.save')} busy={busy} disabled={!dirty} onPress={() => { void save(); }} /></View>
        </View>
        {dirty ? <Button kind="secondary" title={t('editor.discard')} disabled={busy} onPress={() => setConfirmDiscard(true)} /> : null}
      </View>
      <Sheet visible={!!sheetItem} title={sheetItem ? rowName(sheetItem) : ''} onClose={() => open(null)} closeLabel={t('editor.ok')}
        footer={<Button kind="secondary" title={t('editor.cancelEdit')} onPress={() => { if (snapshot.current) dispatch({ type: 'restore', draft: snapshot.current }); open(null); }} />}>
        {sheetItem ? renderBuilder(sheetItem) : null}
      </Sheet>
    </View>
  );
}

