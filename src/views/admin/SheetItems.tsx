// Management › תפילות וזמנים › "הגיליון השבועי" (UX-DESIGN §19.3, frame P44): what goes under the times on the printed sheet and on "השבוע בקהילה".
// One list from the server (`GET /sheet/{week}`): gabbaim's lines come in by themselves, members' wait for one tap; the gabbai can remove, shorten,
// reorder and add a free line. Wide screens show the live A4 sheet beside the lists. The fit numbers come from the same `fitSheet` the print uses.
import React from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { config } from '../../config.ts';
import { ApiCodeError } from '../../client/errors.ts';
import { fixtureNow, fixtureParams } from '../../client/fixtures.ts';
import { isManagement } from '../../client/roles.ts';
import { groupsForScreen, lineOf, meters, patchItem } from '../../client/sheetItems.ts';
import type { Row } from '../../client/sheetItems.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { SheetGroup, SheetItem, SheetPage } from '../../client/types.ts';
import { useSheetItems } from '../../client/useSheetItems.ts';
import { dualDate } from '../../dates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Card, Txt, useTokens } from '../../kit/components.tsx';
import { CountBadge, ListGroup } from '../../kit/NavRows.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { Sheet as PaperSheet, useSheetFonts } from '../../schedule/Sheet.tsx';
import { openPrintPage, sharePdf } from '../../schedule/printSheet.ts';
import { parashaOf } from '../../schedule/parasha.ts';
import { BASE_FIT, fitSheet, rangeParts } from '../../schedule/sheetModel.ts';
import { buildSheet } from '../../schedule/sheetSource.ts';
import type { ScheduleDoc } from '../../schedule/types.ts';
import { computeWeek, israelNow } from '../../schedule/week.ts';
import { weekList } from '../../schedule/editor.ts';
import { zmanimForLocation } from '../../schedule/zmanim.ts';
import { BackLink } from '../Me.tsx';
import { useLogoUri } from '../SchedulePrint.tsx';
import { useWaiting } from '../useWaiting.ts';
import { FitCard } from './sheetItems/FitCard.tsx';
import { FreeItemSheet } from './sheetItems/FreeItemSheet.tsx';
import type { FreeKind } from './sheetItems/FreeItemSheet.tsx';
import { ItemSheet } from './sheetItems/ItemSheet.tsx';
import { RulesSheet } from './sheetItems/RulesSheet.tsx';
import { PendingRow, SheetItemRow } from './sheetItems/SheetItemRow.tsx';
import { WeekPicker } from './scheduleEditor/WeekPicker.tsx';
import { WIDE, useAdminErrText } from './shared.tsx';

type Toast = (text: string, action?: { title: string; onPress: () => void }) => void;
const GROUPS: SheetGroup[] = ['mazal', 'condolence', 'events'];
const A4 = { w: 595, h: 842 };
/** Fixture mode only: `?screen=sheet-items-sheet | -free | -rules` opens that sheet at once. */
const fixtureOpen = (): 'sheet' | 'free' | 'rules' | null => {
  if (!config.fixtures) return null;
  const s = fixtureParams().screen;
  return s === 'sheet-items-sheet' ? 'sheet' : s === 'sheet-items-free' ? 'free' : s === 'sheet-items-rules' ? 'rules' : null;
};

export function SheetItems({ week: startWeek, focus, onBack, onToast, onOpenMessage }: { week?: string; focus?: 'pending'; onBack: () => void; onToast: Toast; onOpenMessage: (id: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const session = useSession();
  const errText = useAdminErrText();
  const waiting = useWaiting();
  const logo = useLogoUri();
  const fonts = useSheetFonts();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const kehilaId = session.state.kehilaId;
  const kehila = session.state.kehila;

  const today = React.useMemo(() => israelNow(fixtureNow() ?? new Date()).date, []);
  const weeks = React.useMemo(() => weekList(today, 2), [today]);
  const [friday, setFriday] = React.useState(() => (weeks.find(w => w.friday === startWeek) ?? weeks.find(w => w.upcoming) ?? weeks[0]!).friday);
  const weekIndex: 0 | 1 = weeks[1]?.friday === friday ? 1 : 0;
  const weekItem = weeks.find(w => w.friday === friday) ?? weeks[0]!;
  const sheetState = useSheetItems(friday);
  const page = sheetState.page;

  const [doc, setDoc] = React.useState<ScheduleDoc | null>(null);
  React.useEffect(() => {
    if (!kehilaId) return;
    let live = true;
    api.schedule(kehilaId).then(d => { if (live) setDoc(d); }, () => {});
    return () => { live = false; };
  }, [api, kehilaId]);

  const model = React.useMemo(() => {
    if (!doc || !page) return null;
    const computed = computeWeek({ version: 1, sections: doc.sections, weekOverrides: doc.weekOverrides }, friday, zmanimForLocation(doc.location));
    return buildSheet(doc, computed, { kehilaName: kehila?.name ?? '', logoUri: logo.uri, items: page.items });
  }, [doc, page, friday, kehila?.name, logo.uri]);
  const fit = React.useMemo(() => (model ? fitSheet(model) : null), [model]);
  const groups = React.useMemo(() => (page && fit ? groupsForScreen(page, fit) : page ? groupsForScreen(page, BASE_FIT('a4')) : null), [page, fit]);

  const [open, setOpen] = React.useState<{ itemId: string } | null>(null);
  const [freeOpen, setFreeOpen] = React.useState(() => fixtureOpen() === 'free');
  const [rulesOpen, setRulesOpen] = React.useState(() => fixtureOpen() === 'rules');
  const [members, setMembers] = React.useState<'approve' | 'auto'>(kehila?.sheetMembers ?? 'approve');
  const [busy, setBusy] = React.useState(false);
  const [announce, setAnnounce] = React.useState('');
  const [sheetError, setSheetError] = React.useState<string | null>(null);
  const [ruleError, setRuleError] = React.useState<string | null>(null);
  const itemsRef = React.useRef<SheetItem[]>([]);
  const busyIds = React.useRef(new Set<string>());
  const [busyIds_, setBusyIds] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<Set<SheetGroup>>(new Set());
  const fixtureSheetDone = React.useRef(false);
  React.useEffect(() => {
    if (fixtureOpen() === 'sheet' && !fixtureSheetDone.current && groups?.mazal[0]) { fixtureSheetDone.current = true; setOpen({ itemId: groups.mazal[0].item.itemId }); }
  }, [groups]);

  const scroller = React.useRef<ScrollView>(null);
  const pendingY = React.useRef<number | null>(null);
  const scrolled = React.useRef(false);
  const maybeScroll = () => { if (focus === 'pending' && !scrolled.current && pendingY.current !== null) { scrolled.current = true; scroller.current?.scrollTo({ y: Math.max(0, pendingY.current - 8), animated: false }); } };

  if (!isManagement(kehila?.role) || !kehilaId) return null;

  // ---- writes: optimistic on the latest list (never a copy from an older render), then what the server answered; a failure puts back only that item ----
  const items = page?.items ?? [];
  itemsRef.current = items;
  const apply = (fn: (list: SheetItem[]) => SheetItem[]) => { itemsRef.current = fn(itemsRef.current); sheetState.setPage({ week: friday, items: itemsRef.current } as SheetPage); };
  /** One write per item at a time: a second tap while it runs is ignored. */
  async function guarded<T>(itemId: string, run: () => Promise<T>): Promise<T | null> {
    if (busyIds.current.has(itemId)) return null;
    busyIds.current.add(itemId); setBusyIds(new Set(busyIds.current));
    try { return await run(); } finally { busyIds.current.delete(itemId); setBusyIds(new Set(busyIds.current)); }
  }
  /** Where an error is seen: inside the open sheet, else as a toast. */
  const fail = (e: unknown, inSheet: boolean) => { if (inSheet) setSheetError(errText(e)); else onToast(errText(e)); };
  async function change(item: SheetItem, body: { state?: SheetItem['state']; line?: { text: string; bold: string } | null }, inSheet = false): Promise<SheetItem | null> {
    const current = itemsRef.current.find(i => i.itemId === item.itemId);
    if (!current) return null;
    const result = await guarded(item.itemId, async () => {
      apply(list => patchItem(list, item.itemId, { ...(body.state ? { state: body.state } : {}), ...(body.line ? { line: body.line } : {}) }));
      try {
        const saved = await api.setSheetItem(kehilaId!, friday, item.itemId, body);
        apply(list => patchItem(list, item.itemId, saved));
        waiting.refresh();
        return saved;
      } catch (e) {
        apply(list => patchItem(list, item.itemId, { state: current.state, ...(current.line ? { line: current.line } : {}) }));
        if (e instanceof ApiCodeError && e.status === 404) void sheetState.reload();
        fail(e, inSheet);
        return null;
      }
    });
    return result;
  }
  const undoTo = (item: SheetItem, state: SheetItem['state']) => () => { void change(item, { state }); };
  async function decide(item: SheetItem, add: boolean) {
    const saved = await change(item, { state: add ? 'in' : 'removed' });
    if (saved) onToast(t(add ? 'sheetItems.added' : 'sheetItems.skipped'), { title: t('sheetItems.undo'), onPress: undoTo(saved, 'pending') });
  }
  async function remove(item: SheetItem) {
    if (busyIds.current.has(item.itemId)) return;
    const saved = await change(item, { state: 'removed' }, true);
    if (saved) { setOpen(null); onToast(t('sheetItems.removedToast'), { title: t('sheetItems.undo'), onPress: undoTo(saved, 'in') }); }
  }
  async function move(item: SheetItem, direction: 'up' | 'down') {
    setSheetError(null);
    await guarded(item.itemId, async () => {
      try {
        const next = await api.moveSheetItem(kehilaId!, friday, item.itemId, direction);
        itemsRef.current = next.items;
        sheetState.setPage(next);
        const list = next.items.filter(i => i.group === item.group && i.state === 'in');
        setAnnounce(t('sheetItems.moved', { i: list.findIndex(i => i.itemId === item.itemId) + 1, n: list.length }));
      } catch (e) { fail(e, true); }
    });
  }
  async function addFree(b: { type: FreeKind; text: string; bold: string }) {
    if (busy) return;
    setBusy(true); setSheetError(null);
    try {
      await api.addSheetItem(kehilaId!, friday, { ...b, source: 'byGabbai' });
      await sheetState.reload();
      setFreeOpen(false);
      onToast(t('sheetItems.added'));
    } catch (e) { fail(e, true); } finally { setBusy(false); }
  }
  async function pickRule(v: 'approve' | 'auto') {
    const before = members;
    setMembers(v);
    try { await api.putSettings(kehilaId!, { sheetMembers: v }); await session.refreshKehila(); } catch (e) { setMembers(before); setRuleError(errText(e)); }
  }
  async function saveLine(item: SheetItem, line: { text: string; bold: string }) {
    setBusy(true); setSheetError(null);
    const saved = await change(item, { line }, true);
    setBusy(false);
    if (saved) { setOpen(null); onToast(t('sheetItems.saved')); }
  }
  const preview = async () => {
    if (Platform.OS === 'web') { if (!openPrintPage(weekIndex)) onToast(t('schedule.printError')); return; }
    if (!model) return;
    try { await sharePdf(model); } catch { onToast(t('schedule.printError')); }
  };

  // ---- pieces ----
  const label = (g: SheetGroup) => t(g === 'mazal' ? 'sheetItems.groupMazal' : g === 'condolence' ? 'sheetItems.groupCondolence' : 'sheetItems.groupEvents');
  const rowsOf = (g: SheetGroup): Row[] => (groups ? groups[g === 'events' ? 'events' : g] : []);
  const opened = open ? items.find(i => i.itemId === open.itemId) ?? null : null;
  const openedRow = opened ? rowsOf(opened.group).find(r => r.item.itemId === opened.itemId) : undefined;
  const total = items.filter(i => i.state === 'in').length;

  const group = (g: SheetGroup) => {
    const rows = rowsOf(g);
    const removed = groups?.removed[g] ?? [];
    if (rows.length === 0 && removed.length === 0) return null;
    const shown = expanded.has(g);
    return (
      <View key={g} style={{ gap: 8 }}>
        <Txt size="small" bold color={k.muted} accessibilityRole="header">{`${label(g)} · ${rows.length}`}</Txt>
        <View style={{ borderWidth: 1, borderColor: k.line, borderRadius: 12, backgroundColor: k.surface, overflow: 'hidden' }}>
          {rows.map((r, i) => <SheetItemRow key={r.item.itemId} row={r} last={i === rows.length - 1 && removed.length === 0} onMore={() => setOpen({ itemId: r.item.itemId })} />)}
          {removed.length > 0 ? (
            <View style={{ borderTopWidth: rows.length ? 1 : 0, borderTopColor: k.line }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: shown }} onPress={() => setExpanded(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; })} style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }}>
                <Txt size="small" bold color={k.muted}>{t('sheetItems.removed', { n: removed.length })}</Txt>
              </Pressable>
              {shown ? removed.map(item => (
                <View key={item.itemId} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: k.line }}>
                  <View style={{ flex: 1 }}><Txt size="small" color={k.muted} content>{lineSummary(item)}</Txt></View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${t('sheetItems.restore')}: ${lineSummary(item)}`} onPress={() => { void change(item, { state: 'in' }); }} disabled={busyIds_.has(item.itemId)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
                    <Txt size="small" bold color={k.tekhelet}>{t('sheetItems.restore')}</Txt>
                  </Pressable>
                </View>
              )) : null}
            </View>
          ) : null}
        </View>
      </View>
    );
  };
  const mazalRows = groups ? groups.mazal.length : 0;

  const lists = (
    <View style={{ gap: 16 }}>
      {sheetState.status === 'error' ? <Banner tone="error" text={t('editor.loadError')} action={{ title: t('common.retry'), onPress: () => { void sheetState.reload(); } }} /> : null}
      {sheetState.status === 'loading' && !page ? <Card><Txt color={k.muted}>{t('common.loading')}</Txt></Card> : null}
      {fit && groups ? <FitCard m={meters(model!, fit)} onPreview={() => { void preview(); }} /> : null}
      {groups && groups.pending.length > 0 ? (
        <View onLayout={e => { pendingY.current = e.nativeEvent.layout.y; maybeScroll(); }} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt size="small" bold color={k.pomegranate} accessibilityRole="header">{t('sheetItems.pending')}</Txt>
            <CountBadge n={groups.pending.length} />
          </View>
          <View style={{ borderWidth: 1, borderColor: k.line, borderStartWidth: 6, borderStartColor: k.pomegranate, borderRadius: 12, backgroundColor: k.surface, overflow: 'hidden' }}>
            {groups.pending.map((item, i) => <PendingRow key={item.itemId} item={item} disabled={busyIds_.has(item.itemId)} last={i === groups.pending.length - 1} onAdd={() => { void decide(item, true); }} onSkip={() => { void decide(item, false); }} />)}
          </View>
        </View>
      ) : null}
      {groups ? GROUPS.map(group) : null}
      {page && total === 0 && (groups?.pending.length ?? 0) === 0 ? <Card><Txt color={k.muted}>{t('sheetItems.empty')}</Txt></Card> : null}
      {fit && mazalRows >= 0 ? (
        <View accessible accessibilityLabel={`${t('sheetItems.groupImage')}: ${meters(model!, fit).image ? t('sheetItems.meterHas') : t('sheetItems.meterNone')}`} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: k.line, borderRadius: 12, backgroundColor: k.surface }}>
          <Icon name="pin" size={22} color={k.tekhelet} />
          <Txt bold style={{ flex: 1 }}>{t('sheetItems.groupImage')}</Txt>
          <Txt size="small" bold color={k.muted}>{meters(model!, fit).image ? t('sheetItems.meterHas') : t('sheetItems.meterNone')}</Txt>
        </View>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => { setSheetError(null); setFreeOpen(true); }} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: k.tekhelet, borderRadius: 12 }}>
        <Icon name="plus" size={20} color={k.tekhelet} />
        <Txt bold color={k.tekhelet}>{t('sheetItems.addFree')}</Txt>
      </Pressable>
      <ListGroup label={t('sheetItems.rule.members')}>
        <Pressable accessibilityRole="button" onPress={() => setRulesOpen(true)} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt bold>{t('sheetItems.rule.members')}</Txt>
            <Txt size="small" color={k.muted}>{members === 'approve' ? t('sheetItems.rule.approve') : t('sheetItems.rule.auto')}</Txt>
          </View>
          <Icon name="back" size={20} color={k.muted} />
        </Pressable>
      </ListGroup>
    </View>
  );

  const heb = rangeParts(dualDate(weekItem.shabbat, lang));
  const caption = t('sheetItems.caption', { parasha: parashaOf(weekItem.shabbat, lang) ?? '', date: heb.greg ? `${heb.heb} ⁦${heb.greg}⁩` : heb.heb });
  const head = (
    <View style={{ gap: 6 }}>
      <BackLink onPress={onBack} label={t('admin.area.prayers')} />
      <Txt serif size={wide ? 'heading' : 'display'} accessibilityRole="header">{t('sheetItems.title')}</Txt>
      <Txt size="small" color={k.muted}>{caption}</Txt>
      <View style={{ zIndex: 20, alignSelf: 'flex-start' }}><WeekPicker weeks={weeks} friday={friday} changes={{}} onSelect={setFriday} wide={false} /></View>
    </View>
  );
  const live = <View accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}><Txt>{announce}</Txt></View>;
  const sheets = (
    <>
      <ItemSheet error={sheetError} item={opened} index={openedRow?.index ?? 1} count={openedRow?.count ?? 1} busy={busy || (!!opened && busyIds_.has(opened.itemId))} onClose={() => { setOpen(null); setSheetError(null); }}
        onSave={line => { if (opened) void saveLine(opened, line); }} onMove={d => { if (opened) void move(opened, d); }}
        onOpen={() => { if (opened?.message) { setOpen(null); onOpenMessage(opened.message.messageId); } }} onRemove={() => { if (opened) void remove(opened); }} />
      <FreeItemSheet visible={freeOpen} busy={busy} error={sheetError} onClose={() => { setFreeOpen(false); setSheetError(null); }} onAdd={b => { void addFree(b); }} />
      <RulesSheet error={ruleError} visible={rulesOpen} value={members} onPick={v => { void pickRule(v); }} onClose={() => { setRulesOpen(false); setRuleError(null); }} />
    </>
  );

  if (wide) {
    const scale = 0.8;
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {live}
        <ScrollView ref={scroller} style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 640 }} keyboardShouldPersistTaps="handled">
          {head}
          {lists}
        </ScrollView>
        <ScrollView style={{ width: A4.w * scale + 48, flexGrow: 0, flexShrink: 0, backgroundColor: k.surface, borderStartWidth: 1, borderStartColor: k.line }} contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
          {model && fit && fonts ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...({ 'aria-hidden': true } as object)}
              style={{ width: A4.w * scale, height: A4.h * scale, alignItems: 'center', justifyContent: 'center', ...({ boxShadow: '0 2px 12px rgba(21,26,51,0.2)' } as object) }}>
              <View style={{ width: A4.w, height: A4.h, transform: [{ scale }] }}><PaperSheet model={model} fit={fit} /></View>
            </View>
          ) : <Txt color={k.muted}>{t('common.loading')}</Txt>}
        </ScrollView>
        {sheets}
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      {live}
      <PadScroll ref={scroller} contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {head}
        {lists}
      </PadScroll>
      {sheets}
    </View>
  );
}

const lineSummary = (item: SheetItem): string => lineOf(item).main.map(p => p.text).join('');
