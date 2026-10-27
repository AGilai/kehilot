// The map editor (UX-DESIGN §16.4-16.5, frame P29): open a version, assign families to seats or edit the hall's layout, save from a chosen Shabbat,
// history, conflict. All decisions are in src/seats (pure, tested): editModel (draft, assign, move, paint, caps, diff and rebase), grid (selection),
// mapSave (save/conflict/history). This file is the wiring. Gabbaim only; a phone gets the hall and the list, read-only.
import React from 'react';
import { Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider.tsx';
import { fixtureNow } from '../../../client/fixtures.ts';
import type { SeatHolder, SeatLayoutRow } from '../../../client/endpoints.ts';
import { useSession } from '../../../client/SessionProvider.tsx';
import type { AdminFamily } from '../../../client/types.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Banner, Button, Segmented, Txt, useTokens } from '../../../kit/components.tsx';
import { BackIcon } from '../../../kit/Icon.tsx';
import { PadScroll } from '../../../kit/PadScroll.tsx';
import { shortDate } from '../../../schedule/memberView.ts';
import { scheduleWeekOf } from '../../../schedule/week.ts';
import {
  addCol, addHolder, addRow, assignKeys, changeCount, changedPositions, countsByRef, diffDrafts, draftIssues, editReducer, emptyDraft, freeAllOf, freeKeys, heldByOthers,
  initialEdit, isSeat, layoutBodyOf, moveFamily, paintCells, paintLosers, rebaseOnto, removeCol, removeRow, renameBlock, seatCount, seatsOf, setRowLabel, usedHolders,
} from '../../../seats/editModel.ts';
import type { Draft, EditError, Kind, Overlap } from '../../../seats/editModel.ts';
import { defaultEffectiveFrom, openForAnswers } from '../../../seats/effectiveFrom.ts';
import { emptySel, jumpPos, parsePos, selReducer, stepPos } from '../../../seats/grid.ts';
import type { Pos } from '../../../seats/grid.ts';
import { households } from '../../../seats/households.ts';
import { historyRows, loadVersion, saveMap, scheduledAfter, versionToOpen, whenLabel } from '../../../seats/mapSave.ts';
import type { MapApi, Version } from '../../../seats/mapSave.ts';
import { initialSaveSession, saveSessionReducer } from '../../../seats/saveSession.ts';
import { savePlanKey } from '../../../seats/savePlan.ts';
import { useShabbatTitle } from '../../ScheduleCard.tsx';
import { useAdminErrText } from '../shared.tsx';
import { IconBtn } from '../scheduleEditor/controls.tsx';
import type { Key } from '../scheduleEditor/controls.tsx';
import { AssignPanel, CountBubble, countText } from './AssignPanel.tsx';
import { ConflictDialog } from './ConflictDialog.tsx';
import type { ConflictLine, ConflictState } from './ConflictDialog.tsx';
import { Dialog } from './Dialog.tsx';
import { FamilyPicker } from './FamilyPicker.tsx';
import { HallGrid, ZOOMS } from './HallGrid.tsx';
import type { Mods, Zoom } from './HallGrid.tsx';
import { HistoryDialog } from './HistoryDialog.tsx';
import { LayoutPanel } from './LayoutPanel.tsx';
import { SaveDialog } from './SaveDialog.tsx';
import type { SavePhase } from './SaveDialog.tsx';
import { SelectionBar } from './SelectionBar.tsx';

type Dlg = null | 'save' | 'history' | 'picker' | 'others' | 'conflict' | 'paint' | 'confirm';
const ZOOM_ORDER: Zoom[] = ['fit', 'z100', 'z150'];
const KIND_KEYS: Record<string, Kind> = { s: 'seat', a: 'aisle', b: 'bimah', k: 'ark' };

export function MapEditor({ families, holders, layouts, scratch, phone, onLayouts, onHolders, onBack, onPaste, onDirty, onToast }: {
  families: AdminFamily[]; holders: SeatHolder[]; layouts: SeatLayoutRow[]; /** No version exists: start from an empty grid. */ scratch: boolean; phone: boolean;
  onLayouts: (rows: SeatLayoutRow[]) => void; onHolders: (h: SeatHolder[]) => void; onBack: () => void; onPaste: () => void; onDirty: (dirty: boolean) => void; onToast: (text: string) => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const kehilaId = useSession().state.kehilaId!;
  const errText = useAdminErrText();
  const title = useShabbatTitle();
  const now = React.useMemo(() => fixtureNow() ?? new Date(), []);

  const mapApi = React.useMemo<MapApi>(() => ({
    layouts: async () => (await api.seatLayouts(kehilaId)).layouts,
    layout: (f) => api.seatLayout(kehilaId, f),
    assignments: (f) => api.seatAssignments(kehilaId, f),
    createHolder: (b) => api.createSeatHolder(kehilaId, b),
    putLayout: (f, b) => api.putSeatLayout(kehilaId, f, b),
    assignmentsGuard: async (f) => (await api.seatAssignments(kehilaId, f)).updatedAt,
    putAssignments: (f, b) => api.putSeatAssignments(kehilaId, f, b),
  }), [api, kehilaId]);

  // ---- the version and the draft ----
  const [load, setLoad] = React.useState<{ status: 'loading' } | { status: 'ready' } | { status: 'error'; text: string }>({ status: 'loading' });
  const [base, setBase] = React.useState<Version | null>(null);
  const [edit, dispatchEdit] = React.useReducer(editReducer, undefined, () => initialEdit(emptyDraft()));
  const [viewing, setViewing] = React.useState<{ n: number; from: string; until: string | null; version: Version } | null>(null);
  const scratchBase = React.useRef<Draft>(edit.draft);
  const openVersion = React.useCallback(async (from: string | null) => {
    setLoad({ status: 'loading' });
    try {
      if (!from) { setBase(null); dispatchEdit({ type: 'reset', draft: scratchBase.current }); } else { const v = await loadVersion(mapApi, from); setBase(v); dispatchEdit({ type: 'reset', draft: v.draft }); }
      setViewing(null);
      setLoad({ status: 'ready' });
    } catch (e) { setLoad({ status: 'error', text: errText(e) }); }
  }, [mapApi]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void openVersion(scratch ? null : versionToOpen(layouts)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = viewing ? viewing.version.draft : edit.draft;
  const readOnly = !!viewing || phone;
  const cs = React.useMemo(() => diffDrafts(base?.draft ?? scratchBase.current, edit.draft), [base, edit.draft]);
  const changes = changeCount(cs) + (edit.draft.holders.length ? 1 : 0);
  const changed = React.useMemo(() => (viewing ? new Set<Pos>() : changedPositions(cs)), [cs, viewing]);
  React.useEffect(() => { onDirty(changes > 0 && !phone); return () => onDirty(false); }, [changes > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- households ----
  const rows = React.useMemo(() => households(draft, families, holders, t('seatEditor.and')), [draft, families, holders, t]);
  const byRef = React.useMemo(() => new Map(rows.map((r) => [r.ref, r])), [rows]);
  const short = (ref: string) => byRef.get(ref)?.short ?? t('seatMap.panel.holder');
  const full = (ref: string) => byRef.get(ref)?.full ?? t('seatMap.panel.holder');
  const seats = seatCount(draft);
  const assigned = [...countsByRef(draft).values()].reduce((a, b) => a + b, 0);

  // ---- interaction state ----
  const [mode, setMode] = React.useState<'assign' | 'layout'>(scratch ? 'layout' : 'assign');
  // a hall that does not fit the canvas at 100% opens at "fit" (wide halls may scroll, but the first view should show the room)
  const { width: winW } = useWindowDimensions();
  const [zoomPick, setZoom] = React.useState<Zoom | null>(null);
  const zoom: Zoom = zoomPick ?? (phone || edit.draft.layout.cols * ZOOMS.z100.w + 120 > winW - 360 ? 'fit' : 'z100');
  const [selRef, setSelRef] = React.useState<string | null>(null);
  const [sel, dispatchSel] = React.useReducer(selReducer, undefined, emptySel);
  const [focus, setFocus] = React.useState<Pos | null>(null);
  const [moving, setMoving] = React.useState<string | null>(null);
  const [moveError, setMoveError] = React.useState<string | null>(null);
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [others, setOthers] = React.useState<{ keys: Pos[]; ref: string; held: { pos: Pos; ref: string }[]; from: Draft } | null>(null);
  const [paint, setPaint] = React.useState<{ kind: Kind; losers: { ref: string; n: number }[] } | null>(null);
  const [newHolder, setNewHolder] = React.useState(false);
  const [layoutError, setLayoutError] = React.useState<EditError | null>(null);
  const [live, setLive] = React.useState('');
  const [info, setInfo] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<(() => void) | null>(null);
  const searchRef = React.useRef<TextInput>(null);
  const pred = React.useCallback((p: Pos) => (mode === 'assign' || moving ? isSeat(edit.draft, p) : true), [mode, moving, edit.draft]);

  const commit = (d: Draft, say?: string) => { dispatchEdit({ type: 'set', draft: d }); if (say) setLive(say); setInfo(null); };
  const clearSel = () => dispatchSel({ type: 'clear' });
  const askDiscard = (go: () => void) => { if (changes > 0) { setConfirm(() => go); setDlg('confirm'); } else go(); };
  const resetDraft = () => { dispatchEdit({ type: 'reset', draft: base?.draft ?? scratchBase.current }); clearSel(); setMoving(null); setInfo(null); };

  // ---- assigning ----
  const total = (d: Draft, ref: string) => countsByRef(d).get(ref) ?? 0;
  const doAssign = (keys: Pos[], ref: string, from: Draft = edit.draft) => {
    const d = assignKeys(from, keys, ref);
    commit(d, t('seatMap.live.assigned', { n: keys.length, name: short(ref), total: total(d, ref) }));
    clearSel();
  };
  const applyAssign = (keys: Pos[], ref: string, from: Draft = edit.draft) => {
    const held = heldByOthers(from, keys, ref);
    if (held.length) { setOthers({ keys, ref, held, from }); setDlg('others'); } else doAssign(keys, ref, from);
  };
  const doFree = (keys: Pos[]) => { commit(freeKeys(edit.draft, keys), t('seatMap.live.freed', { n: keys.filter((p) => edit.draft.assign[p]).length })); clearSel(); };

  const startMove = () => { if (!selRef) return; setMoving(selRef); setMoveError(null); clearSel(); };
  const confirmMove = () => {
    if (!moving) return;
    const need = seatsOf(edit.draft, moving).length;
    const r = moveFamily(edit.draft, moving, sel.keys);
    if (!r.ok) { setMoveError(r.error === 'taken' ? t('seatMap.move.taken') : r.error === 'not-seat' ? t('seatMap.move.notSeat') : t('seatMap.move.count', { n: need })); return; }
    commit(r.draft, t('seatMap.live.moved', { name: short(moving) }));
    setMoving(null); setMoveError(null); clearSel();
  };
  const cancelMove = () => { setMoving(null); setMoveError(null); clearSel(); };

  const primary = () => {
    if (moving) { confirmMove(); return; }
    if (mode !== 'assign' || !sel.keys.length) return;
    if (!selRef) { setDlg('picker'); return; }
    if (sel.keys.every((p) => edit.draft.assign[p] === selRef)) doFree(sel.keys); else applyAssign(sel.keys, selRef);
  };

  // ---- layout mode ----
  const paintSel = (kind: Kind) => {
    if (!sel.keys.length) return;
    const losers = paintLosers(edit.draft, sel.keys, kind);
    if (losers.length) { setPaint({ kind, losers }); setDlg('paint'); return; }
    commit(paintCells(edit.draft, sel.keys, kind), t('seatMap.live.painted', { n: sel.keys.length }));
  };
  const apply = (r: ReturnType<typeof addRow>) => { if (r.ok) { commit(r.draft); setLayoutError(null); } else setLayoutError(r.error); };
  const focusRC = focus ? parsePos(focus) : null;

  // ---- pointer ----
  const onDown = (pos: Pos, m: Mods) => {
    setFocus(pos);
    if (moving || m.ctrl) dispatchSel({ type: 'toggle', pos, pred });
    else if (m.shift) dispatchSel({ type: 'to', pos, pred });
    else dispatchSel({ type: 'start', pos, pred });
  };
  const onDrag = (pos: Pos) => { setFocus(pos); if (!moving) dispatchSel({ type: 'to', pos, pred }); };
  const onUp = (pos: Pos, dragged: boolean, m: Mods) => {
    if (dragged || m.ctrl || m.shift || moving || mode !== 'assign' || !isSeat(edit.draft, pos)) return;
    const ref = edit.draft.assign[pos];
    if (!selRef) { if (ref) setSelRef(ref); return; }
    if (ref === selRef) doFree([pos]);
    else if (ref) applyAssign([pos], selRef);
    else doAssign([pos], selRef);
  };

  // ---- keyboard ----
  const zoomBy = (d: number) => setZoom(ZOOM_ORDER[Math.max(0, Math.min(2, ZOOM_ORDER.indexOf(zoom) + d))]!);
  const openSave = () => { if (changes > 0) { setSavePhase({ name: 'idle' }); setDlg('save'); } };
  const onKey = (key: Key) => {
    if (readOnly || dlg) return;
    const L = edit.draft.layout;
    const cur = focus ?? '0:0';
    const mod = key.ctrl || key.meta;
    if (mod && key.key.toLowerCase() === 'z') { key.prevent(); dispatchEdit({ type: key.shift ? 'redo' : 'undo' }); return; }
    if (mod && key.key.toLowerCase() === 's') { key.prevent(); openSave(); return; }
    const arrow = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[key.key as 'ArrowLeft'];
    if (arrow || ['Home', 'End', 'PageUp', 'PageDown'].includes(key.key)) {
      key.prevent();
      const next = arrow ? stepPos(cur, arrow, L.rows, L.cols) : jumpPos(cur, key.key === 'Home' ? 'home' : key.key === 'End' ? 'end' : key.key === 'PageUp' ? 'front' : 'back', L.rows, L.cols);
      if (key.shift && !moving) { if (!sel.anchor) dispatchSel({ type: 'anchor', pos: cur }); dispatchSel({ type: 'to', pos: next, pred }); } else dispatchSel({ type: 'anchor', pos: next });
      setFocus(next);
      return;
    }
    if (key.key === ' ') { key.prevent(); dispatchSel({ type: 'toggle', pos: cur, pred }); return; }
    if (key.key === 'Enter') { key.prevent(); primary(); return; }
    if (key.key === 'Escape') { if (moving) cancelMove(); else clearSel(); return; }
    if (key.key === 'Delete' || key.key === 'Backspace') { key.prevent(); if (mode === 'assign') doFree(sel.keys); else paintSel('empty'); return; }
    if (key.key === '/' ) { key.prevent(); searchRef.current?.focus(); return; }
    if (key.key === '+' || key.key === '=') { zoomBy(1); return; }
    if (key.key === '-') { zoomBy(-1); return; }
    if (key.key === '0') { setZoom('fit'); return; }
    if (mode === 'assign' && key.key.toLowerCase() === 'm') { startMove(); return; }
    if (mode === 'layout' && KIND_KEYS[key.key.toLowerCase()]) { paintSel(KIND_KEYS[key.key.toLowerCase()]!); }
  };

  // ---- save ----
  const [saveFrom, setSaveFrom] = React.useState(() => defaultEffectiveFrom(now));
  const [savePhase, setSavePhase] = React.useState<SavePhase>({ name: 'idle' });
  const [session, dispatchSession] = React.useReducer(saveSessionReducer, undefined, initialSaveSession);
  React.useEffect(() => { if (base && base.from >= defaultEffectiveFrom(now) && !openForAnswers(now, base.from, null)) setSaveFrom(base.from); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const planKey = React.useMemo(() => savePlanKey(saveFrom, layoutBodyOf(edit.draft), usedHolders(edit.draft), edit.draft.assign), [saveFrom, edit.draft]);
  React.useEffect(() => { dispatchSession({ type: 'sync', key: planKey }); }, [planKey]);
  const [weekOpen, setWeekOpen] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (dlg !== 'save') return;
    let live2 = true;
    setWeekOpen(null);
    api.seatWeek(kehilaId, saveFrom).then((w) => { if (live2) setWeekOpen(w.open); }, () => { if (live2) setWeekOpen(null); });
    return () => { live2 = false; };
  }, [api, kehilaId, saveFrom, dlg]);
  const issues = React.useMemo(() => draftIssues(edit.draft), [edit.draft]);

  const refreshLists = async () => {
    try { onLayouts((await api.seatLayouts(kehilaId)).layouts); } catch { /* the list is only a hint */ }
    try { onHolders(await api.seatHolders(kehilaId)); } catch { /* ignore */ }
  };
  const doSave = async (overwrite = false) => {
    setSavePhase({ name: 'running', progress: { step: 'holders', done: 0, total: usedHolders(edit.draft).length } });
    const result = await saveMap({ api: mapApi, draft: edit.draft, base, from: saveFrom, carry: session.carry, known: session.holders, overwrite, onProgress: (progress) => setSavePhase({ name: 'running', progress }) });
    dispatchSession({ type: 'result', result });
    if (result.ok) {
      await refreshLists();
      try {
        const v = await loadVersion(mapApi, saveFrom);
        setBase(v); dispatchEdit({ type: 'reset', draft: v.draft });
      } catch { /* the saved version could not be re-read; the editor keeps the draft as the new base */ }
      setSavePhase({ name: 'idle' }); setDlg(null); setSelRef(null); clearSel(); setInfo(null);
      onToast(t('seatMap.save.toast'));
    } else if (result.conflict) { setSavePhase({ name: 'idle' }); setDlg('conflict'); void startConflict(); } else {
      setSavePhase({ name: 'failed', result, text: result.code === 'invalid_layout' && result.field ? `${errText({ code: result.code })} (${result.field})` : errText({ code: result.code }) });
    }
  };
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  const removeMade = async (id: string) => {
    try { await api.deleteSeatHolder(kehilaId, id); dispatchSession({ type: 'removeHolder', id }); setRemoveError(null); } catch (e) { setRemoveError(errText(e)); }
  };
  const partial = (
    <View style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: k.gold, borderStartWidth: 6 }}>
      <Txt bold>{t('seatEditor.save.partialTitle')}</Txt>
      <Txt size="small" color={k.muted}>{t('seatEditor.save.partialBody')}</Txt>
      {session.holders.map((h) => (
        <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt content style={{ flex: 1 }}>{h.name}</Txt>
          <Button kind="secondary" title={t('seatEditor.save.removeHolder')} onPress={() => { void removeMade(h.id); }} />
        </View>
      ))}
      {removeError ? <Banner tone="error" text={removeError} /> : null}
      <View style={{ alignSelf: 'flex-start' }}><Button kind="danger" title={t('seatEditor.save.discardPartial')} onPress={() => { dispatchSession({ type: 'discard' }); setSavePhase({ name: 'idle' }); }} /></View>
    </View>
  );

  // ---- conflict ----
  const [conflict, setConflict] = React.useState<{ state: 'loading' } | { state: 'error' } | { state: 'ready'; theirs: Version; rows: SeatLayoutRow[]; holders: SeatHolder[] }>({ state: 'loading' });
  const [pick, setPick] = React.useState<Record<string, 'mine' | 'theirs'>>({});
  const [conflictBusy, setConflictBusy] = React.useState(false);
  const startConflict = async () => {
    setConflict({ state: 'loading' }); setPick({});
    try {
      const [theirs, rowsNow, hs] = await Promise.all([loadVersion(mapApi, saveFrom), mapApi.layouts(), api.seatHolders(kehilaId).catch(() => holders)]);
      setConflict({ state: 'ready', theirs, rows: rowsNow, holders: hs });
    } catch { setConflict({ state: 'error' }); }
  };
  const conflictBase = base?.draft ?? scratchBase.current;
  const cellKindText = (v: string | null) => (v ? t(`seatMap.grid.${v}`) : '—');
  const refText = (hs: SeatHolder[], ref: string | null) => {
    if (!ref) return t('seatMap.grid.free');
    const known = byRef.get(ref);
    if (known) return known.full;
    if (ref.startsWith('holder:')) return hs.find((h) => h.holderId === ref.slice(7))?.name ?? t('seatMap.panel.holder');
    return t('seatMap.panel.holder');
  };
  const conflictView = React.useMemo((): ConflictState => {
    if (conflict.state !== 'ready') return { phase: conflict.state === 'loading' ? 'loading' : 'error' };
    const theirsDraft = conflict.theirs.draft;
    const L = theirsDraft.layout;
    const where = (p: Pos) => { const { r, c } = parsePos(p); const b = L.blocks.find((x) => c >= x.colStart && c <= x.colEnd)?.name ?? ''; const lab = L.rowLabels[r]; return [b, lab ? t('seatMap.grid.row', { row: lab }) : t('seatMap.grid.row', { row: r + 1 })].filter(Boolean).join(', '); };
    const line = (o: Overlap): ConflictLine => ({ key: `${o.pos}|${o.what}`, where: where(o.pos), theirs: o.what === 'cell' ? cellKindText(o.theirs) : refText(conflict.holders, o.theirs), mine: o.what === 'cell' ? cellKindText(o.mine) : refText(conflict.holders, o.mine) });
    const rb = rebaseOnto(theirsDraft, conflictBase, edit.draft, pick);
    const theirCs = diffDrafts(conflictBase, theirsDraft);
    const theirChanges: ConflictLine[] = [
      ...Object.entries(theirCs.assign).map(([p, v]) => ({ key: `a${p}`, where: where(p), theirs: refText(conflict.holders, v) })),
      ...Object.entries(theirCs.cells).filter(([p]) => !(p in theirCs.assign)).map(([p, v]) => ({ key: `c${p}`, where: where(p), theirs: cellKindText(v) })),
    ];
    const row = conflict.rows.find((r) => r.effectiveFrom === saveFrom);
    return { phase: 'ready', theirsAt: row ? whenLabel(row.updatedAt) : null, theirs: changeCount(theirCs), yours: changeCount(diffDrafts(conflictBase, edit.draft)), overlap: rb.overlaps.length, overlaps: rb.overlaps.map(line), theirChanges };
  }, [conflict, pick, edit.draft, conflictBase, saveFrom, byRef, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyConflict = () => {
    if (conflict.state !== 'ready') return;
    setConflictBusy(true);
    const r = rebaseOnto(conflict.theirs.draft, conflictBase, edit.draft, pick);
    setBase(conflict.theirs); onLayouts(conflict.rows); onHolders(conflict.holders);
    dispatchEdit({ type: 'reset', draft: r.draft });
    setViewing(null); clearSel(); setMoving(null);
    setInfo(r.overlaps.length ? t('seatMap.conflict.appliedOverlap', { n: r.overlaps.length }) : t('seatMap.conflict.applied'));
    setConflictBusy(false); setDlg(null);
  };
  const overwrite = () => { setDlg('save'); void doSave(true); };

  // ---- history ----
  const hist = React.useMemo(() => historyRows(layouts, now), [layouts, now]);
  const dateLabel = (from: string) => { const w = scheduleWeekOf(from); return `${title({ friday: w.friday, shabbat: w.shabbat, weekdays: [], thursday: w.thursday })} · ${shortDate(from)}`; };
  const viewVersion = async (from: string) => {
    try { const v = await loadVersion(mapApi, from); const h = hist.find((x) => x.from === from)!; setViewing({ n: h.n, from, until: h.until, version: v }); setDlg(null); setMode('assign'); clearSel(); setMoving(null); }
    catch (e) { setInfo(errText(e)); setDlg(null); }
  };
  const restore = async (from: string) => {
    const go = async () => {
      try { const v = await loadVersion(mapApi, from); dispatchEdit({ type: 'set', draft: { ...v.draft, holders: [] } }); setViewing(null); setDlg(null); setInfo(null); clearSel(); }
      catch (e) { setInfo(errText(e)); setDlg(null); }
    };
    askDiscard(() => { void go(); });
  };

  // ---- rendering ----
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('editor.back')} onPress={onBack} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('editor.back')}</Txt></View>
    </Pressable>
  );
  if (load.status !== 'ready') {
    return (
      <View style={{ padding: 24, maxWidth: 760 }}>
        {load.status === 'error' ? <Banner tone="error" text={`${t('seatMap.loadFailed')} ${load.text}`} action={{ title: t('common.retry'), onPress: () => { void openVersion(scratch ? null : versionToOpen(layouts)); } }} /> : <Txt color={k.muted}>{t('seatMap.loading')}</Txt>}
      </View>
    );
  }

  const blockOnTop = new Set(selRef ? draft.layout.blocks.filter((b) => seatsOf(draft, selRef).some((p) => { const c = parsePos(p).c; return c >= b.colStart && c <= b.colEnd; })).map((b) => b.name) : []);
  const struck = new Set<Pos>(moving ? seatsOf(edit.draft, moving) : []);
  const gridMode = readOnly ? 'readonly' : mode;
  const headVersion = viewing ? null : base;
  const bandText = viewing
    ? (viewing.until ? t('seatMap.view.band', { n: viewing.n, from: dateLabel(viewing.from), to: dateLabel(viewing.until) }) : t('seatMap.view.bandOpen', { n: viewing.n, from: dateLabel(viewing.from) }))
    : base ? `${t('seatMap.band.version', { n: hist.find((h) => h.from === base.from)?.n ?? 1, from: dateLabel(base.from) })} · ${t('seatMap.band.saved', { when: whenLabel(base.updatedAt) })}` : t('seatMap.band.draft');
  const later = headVersion ? scheduledAfter(layouts, headVersion.from) : null;
  const hallProps = { draft, mode: gridMode, zoom, sel: viewing ? [] : sel.keys, focus: viewing ? null : focus, changed, selectedRef: viewing ? null : selRef, struck, short, full, blockOnTop, onDown, onDrag, onUp, onKey } as const;

  // phone: view only. The hall (zoom for names) and the list of households with counts.
  if (phone) {
    const list = rows.filter((r) => r.count > 0 || r.noAccount);
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 12, width: '100%', alignSelf: 'center' }}>
        {back}
        <Txt serif size="display" accessibilityRole="header">{t('seatEditor.title')}</Txt>
        <Banner tone="info" text={t('seatMap.phone.banner')} />
        <Txt size="small" color={k.muted}>{t('seatMap.phone.hint')}</Txt>
        <Segmented options={[{ key: 'fit', label: t('seatMap.tool.fit') }, { key: 'z100', label: t('seatMap.tool.z100') }]} value={zoom === 'z150' ? 'z100' : zoom} onChange={setZoom} />
        <HallGrid {...hallProps} mode="readonly" selectedRef={null} />
        <Txt serif size="heading" accessibilityRole="header">{t('seatMap.phone.families')}</Txt>
        {list.map((r) => <View key={r.ref} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}><CountBubble n={r.count} /><Txt style={{ flex: 1 }} content>{r.full}</Txt></View>)}
      </PadScroll>
    );
  }

  const toolbar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 8, backgroundColor: k.surface, borderBottomWidth: 1, borderBottomColor: k.line, flexWrap: 'wrap' }}>
      <View style={{ width: 300 }}><Segmented options={[{ key: 'assign', label: t('seatMap.mode.assign') }, { key: 'layout', label: t('seatMap.mode.layout') }]} value={mode} onChange={(m) => { if (!readOnly && !moving) { setMode(m); clearSel(); } }} /></View>
      <Button kind="secondary" icon="hist" title={t('seatMap.tool.history')} onPress={() => setDlg('history')} />
      <IconBtn icon="undo" label={t('seatMap.tool.undo')} disabled={readOnly || !edit.past.length} onPress={() => dispatchEdit({ type: 'undo' })} size={40} />
      <IconBtn icon="redo" label={t('seatMap.tool.redo')} disabled={readOnly || !edit.future.length} onPress={() => dispatchEdit({ type: 'redo' })} size={40} />
      <View style={{ width: 280 }}><Segmented options={ZOOM_ORDER.map((z) => ({ key: z, label: t(`seatMap.tool.${z === 'fit' ? 'fit' : z}`) }))} value={zoom} onChange={setZoom} /></View>
      <View style={{ flex: 1 }} />
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {changes > 0 ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: k.gold }} /> : null}
        <Txt size="small" color={changes > 0 ? k.gold : k.muted} bold={changes > 0}>{changes > 0 ? t('seatMap.tool.unsaved', { n: changes }) : t('seatMap.tool.saved')}</Txt>
      </View>
      <Button kind="secondary" title={t('seatMap.tool.reset')} disabled={readOnly || changes === 0} onPress={() => askDiscard(resetDraft)} />
      <Button title={t('seatMap.tool.save')} disabled={readOnly || changes === 0} onPress={openSave} />
    </View>
  );
  const band = (
    <View style={{ paddingHorizontal: 24, paddingVertical: 8, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Txt size="small" bold color={viewing ? k.gold : k.muted}>{bandText}</Txt>
        {viewing ? (
          <>
            <Button kind="secondary" title={t('seatMap.view.back')} onPress={() => setViewing(null)} />
            <Button kind="secondary" title={t('seatMap.view.restore')} onPress={() => { void restore(viewing.from); }} />
          </>
        ) : <Button kind="secondary" title={t('seatMap.tool.paste')} onPress={() => askDiscard(onPaste)} />}
      </View>
      {later && !viewing ? <Banner text={t('seatMap.band.scheduled', { from: dateLabel(later) })} /> : null}
      {info ? <Banner tone="success" text={info} /> : null}
    </View>
  );
  const needN = moving ? seatsOf(edit.draft, moving).length : 0;
  let bar: React.ReactNode = null;
  if (!readOnly) {
    if (moving) {
      bar = <SelectionBar text={`${t('seatMap.move.banner', { name: short(moving), n: needN, m: sel.keys.length })}${moveError ? ` · ${moveError}` : ''}`} actions={[{ key: 'ok', label: t('seatMap.move.confirm'), onPress: confirmMove, disabled: sel.keys.length !== needN }, { key: 'no', label: t('seatMap.move.cancel'), onPress: cancelMove }]} />;
    } else if (sel.keys.length) {
      const text = mode === 'layout' ? t('seatMap.bar.cells', { n: sel.keys.length }) : sel.keys.length === 1 ? t('seatMap.bar.one') : t('seatMap.bar.n', { n: sel.keys.length });
      bar = <SelectionBar text={text} actions={mode === 'assign'
        ? [...(selRef ? [{ key: 'to', label: t('seatMap.bar.assignTo', { name: short(selRef) }), onPress: () => applyAssign(sel.keys, selRef) }] : []), { key: 'other', label: t('seatMap.bar.assignOther'), onPress: () => setDlg('picker') }, { key: 'free', label: t('seatMap.bar.free'), onPress: () => doFree(sel.keys) }, { key: 'clear', label: t('seatMap.bar.clear'), onPress: clearSel }]
        : [{ key: 'clear', label: t('seatMap.bar.clear'), onPress: clearSel }]} />;
    }
  }
  const panelRows = rows;
  const panel = mode === 'assign' || viewing ? (
    <AssignPanel rows={panelRows} selected={viewing ? null : selRef} totals={{ seats, assigned, free: seats - assigned }} onSelect={(r) => { if (!viewing) setSelRef(r); }} onMove={startMove}
      onFreeAll={() => { if (selRef) commit(freeAllOf(edit.draft, selRef), t('seatMap.live.freed', { n: total(edit.draft, selRef) })); }} onNewHolder={() => { setNewHolder(true); setDlg('picker'); }} searchRef={searchRef} moving={!!moving || !!viewing} />
  ) : (
    <LayoutPanel draft={edit.draft} selected={sel.keys.length} focusRow={focusRC ? focusRC.r : null} error={layoutError}
      onPaint={paintSel} onAddRow={(w) => apply(addRow(edit.draft, w))} onAddCol={(w) => apply(addCol(edit.draft, w))}
      onRemoveRow={() => { if (focusRC) apply(removeRow(edit.draft, focusRC.r)); }} onRemoveCol={() => { if (focusRC) apply(removeCol(edit.draft, focusRC.c)); }}
      onBlockName={(i, name) => commit(renameBlock(edit.draft, i, name))} onRowLabel={(r, v) => commit(setRowLabel(edit.draft, r, v))} />
  );

  const pickerCount = sel.keys.length;
  const assignFromPicker = (ref: string, from: Draft = edit.draft) => { setDlg(null); setNewHolder(false); setSelRef(ref); if (sel.keys.length) applyAssign(sel.keys, ref, from); };

  return (
    <View style={{ flex: 1 }}>
      {toolbar}
      {band}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 90 }}>
            <HallGrid {...hallProps} />
          </ScrollView>
          {bar}
        </View>
        {panel}
      </View>
      <View accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}><Txt size="caption">{live}</Txt></View>

      <FamilyPicker visible={dlg === 'picker'} count={pickerCount} rows={rows} startNew={newHolder} onClose={() => { setDlg(null); setNewHolder(false); }} onPick={assignFromPicker}
        onNew={(name, ph) => { const h = addHolder(edit.draft, name, ph); if (sel.keys.length) assignFromPicker(h.ref, h.draft); else { commit(h.draft); assignFromPicker(h.ref, h.draft); } }} />

      <Dialog visible={dlg === 'others'} alert title={others && others.held.length === 1 ? t('seatMap.others.title', { name: short(others.held[0]!.ref) }) : t('seatMap.picker.title')} onClose={() => setDlg(null)}
        footer={others ? (
          <>
            <Button title={t('seatMap.others.move', { name: short(others.ref) })} onPress={() => { doAssign(others.keys, others.ref, others.from); setDlg(null); }} />
            <Button kind="secondary" title={t('seatMap.others.free')} onPress={() => { commit(freeKeys(others.from, others.held.map((h) => h.pos)), t('seatMap.live.freed', { n: others.held.length })); clearSel(); setDlg(null); }} />
            <Button kind="secondary" title={t('seatMap.others.cancel')} onPress={() => setDlg(null)} />
          </>
        ) : undefined}>
        {others ? <Txt>{others.held.length === 1 ? t('seatMap.others.body') : t('seatMap.others.bodyMany', { n: others.held.length, names: [...new Set(others.held.map((h) => short(h.ref)))].join(', ') })}</Txt> : null}
      </Dialog>

      <Dialog visible={dlg === 'paint'} alert title={t('seatMap.layout.palette')} onClose={() => setDlg(null)}
        footer={<><Button title={t('seatMap.layout.warnYes')} onPress={() => { if (paint) commit(paintCells(edit.draft, sel.keys, paint.kind), t('seatMap.live.painted', { n: sel.keys.length })); setDlg(null); }} /><Button kind="secondary" title={t('seatMap.layout.warnNo')} onPress={() => setDlg(null)} /></>}>
        {paint ? <Txt>{t('seatMap.layout.warn', { n: paint.losers.reduce((a, b) => a + b.n, 0), names: paint.losers.map((l) => `${short(l.ref)} (${l.n})`).join(', ') })}</Txt> : null}
      </Dialog>

      <Dialog visible={dlg === 'confirm'} alert title={t('seatMap.discard.title')} onClose={() => setDlg(null)}
        footer={<><Button kind="danger" title={t('seatMap.discard.yes')} onPress={() => { setDlg(null); if (confirm) confirm(); setConfirm(null); }} /><Button kind="secondary" title={t('seatMap.discard.no')} onPress={() => { setDlg(null); setConfirm(null); }} /></>}>
        <Txt>{t('seatMap.discard.body', { n: changes })}</Txt>
      </Dialog>

      <HistoryDialog visible={dlg === 'history'} rows={hist} openFrom={viewing?.from ?? base?.from ?? null} dirtyCount={changes} dateLabel={dateLabel} onClose={() => setDlg(null)}
        onView={(f) => { void viewVersion(f); }} onRestore={(f) => { void restore(f); }}
        onOpen={(f) => { askDiscard(() => { setDlg(null); void openVersion(f); }); }} />

      <SaveDialog visible={dlg === 'save'} cs={cs} issues={issues} layouts={layouts} openedFrom={base?.from ?? null} now={now} from={saveFrom} isOpen={openForAnswers(now, saveFrom, weekOpen)}
        phase={savePhase} newHolders={usedHolders(edit.draft).length} onFrom={(f) => { if (savePhase.name !== 'running') setSaveFrom(f); }} onGo={() => { void doSave(false); }} onClose={() => setDlg(null)} partial={partial} />

      <ConflictDialog visible={dlg === 'conflict'} state={conflictView} pick={pick} onPick={(key, v) => setPick((p) => ({ ...p, [key]: v }))} onApply={applyConflict} onOverwrite={overwrite} onClose={() => setDlg(null)} busy={conflictBusy} />
    </View>
  );
}
