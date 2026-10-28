import React from 'react';
import { ActivityIndicator, Pressable, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { AREA_IDS, areas, todoItems } from '../../client/adminAreas.ts';
import type { Area, AreaId, AreaRow, AreaTarget, TodoItem } from '../../client/adminAreas.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { SimchaWeek } from '../../client/types.ts';
import { nextSimcha, simchaTitle } from '../../client/simchasView.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Card, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import type { IconName } from '../../kit/Icon.tsx';
import { ListGroup, NavRow } from '../../kit/NavRows.tsx';
import { CountBadge } from '../../kit/NavRows.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { useShabbat } from '../../seats/useShabbat.ts';
import { BackLink } from '../Me.tsx';
import { useWaiting } from '../useWaiting.ts';
import { CapSheet, PrivacyContactSheet, TermsSheet, termsDate } from './SettingsSheets.tsx';
import { WIDE, useAdminErrText, useShortDate } from './shared.tsx';

/** Screens a row can open (the settings rows open Sheets here instead). */
export type GoTarget = Exclude<AreaTarget, `sheet:${string}`>;

export const AREA_ICON: Record<AreaId, IconName> = { prayers: 'clock', seats: 'chair', messages: 'msg', simchas: 'cal', people: 'users', settings: 'sliders' };
const ROW_ICON: Record<string, IconName> = {
  schedule: 'clock', sheet: 'print', print: 'print', behalf: 'edit', responses: 'copy', editor: 'grid', holders: 'users', compose: 'send', channels: 'msg', types: 'sliders', pushTexts: 'bell',
  simchas: 'cal', aliyot: 'book', approvals: 'check', members: 'users', tags: 'pin', groups: 'users', invite: 'link', import: 'copy', cap: 'sliders', privacy: 'shield', terms: 'book',
};

type Data = {
  members: number; listeners: number; groups: number | null; channels: number | null; invites: number | null;
  cap: number | undefined; contact: string; terms: { name: string; at: number } | null | undefined;
  schedule: { saved: boolean; updatedAt: number | null } | null; weeks: SimchaWeek[] | null;
};

/** The numbers behind the status lines. Every call is best effort: a failure leaves that line out. */
function useAreaData(): { data: Data | null; error: string | null; reload: () => Promise<void> } {
  const { api } = useAuth();
  const { state } = useSession();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const reload = React.useCallback(async () => {
    const [mem, keh, inv, grp, chn, sch, sim] = await Promise.allSettled([api.members(kehilaId), api.kehila(kehilaId), api.invites(kehilaId), api.groups(kehilaId), api.channels(kehilaId), api.schedule(kehilaId), api.simchas(kehilaId, 8)]);
    const failed = [mem, keh].find(x => x.status === 'rejected');
    setError(failed && failed.status === 'rejected' ? errText(failed.reason) : null);
    setData(prev => ({
      members: mem.status === 'fulfilled' ? mem.value.filter(m => m.role !== 'listener').length : prev?.members ?? 0,
      listeners: mem.status === 'fulfilled' ? mem.value.filter(m => m.role === 'listener').length : prev?.listeners ?? 0,
      groups: grp.status === 'fulfilled' ? grp.value.length : prev?.groups ?? null,
      channels: chn.status === 'fulfilled' ? chn.value.filter(c => !c.conversation).length : prev?.channels ?? null,
      invites: inv.status === 'fulfilled' ? inv.value.length : prev?.invites ?? null,
      cap: keh.status === 'fulfilled' ? keh.value.settings.maxListeners : prev?.cap,
      contact: keh.status === 'fulfilled' ? keh.value.privacyContact ?? '' : prev?.contact ?? '',
      terms: keh.status === 'fulfilled' ? keh.value.termsAccepted : prev?.terms,
      schedule: sch.status === 'fulfilled' ? { saved: sch.value.sections.length > 0, updatedAt: sch.value.updatedAt } : prev?.schedule ?? null,
      weeks: sim.status === 'fulfilled' ? sim.value.weeks : prev?.weeks ?? null,
    }));
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

/** A compact row for the wide grid cards. */
function MiniRow({ title, badge, onPress }: { title: string; badge?: number; onPress?: () => void }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={!onPress} onPress={onPress} style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
      <Txt color={onPress ? k.ink : k.muted} style={{ flex: 1 }}>{title}</Txt>
      {badge ? <CountBadge n={badge} /> : null}
    </Pressable>
  );
}

/**
 * §18.3: the management overview (area = null) and a group screen (area = id). The overview answers two questions only:
 * what is waiting ("לטיפול עכשיו") and where things are (six groups). It has no edit fields; settings rows show their value
 * and open a Sheet. Below 1024 the groups are 72-high rows, from 1024 a 3-column grid of cards that list their rows.
 */
export function Overview({ area, onArea, onGo, onBack, onToast }: { area: AreaId | null; onArea: (id: AreaId) => void; onGo: (target: GoTarget) => void; onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const { state, refreshKehila } = useSession();
  const k = useTokens();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const waiting = useWaiting();
  const date = useShortDate();
  const { parasha } = useShabbat();
  const { data, error, reload } = useAreaData();
  const [sheet, setSheet] = React.useState<'cap' | 'privacy' | 'terms' | null>(null);
  const { refresh } = waiting;
  React.useEffect(() => { refresh(); }, [refresh]);
  const role = state.kehila?.role;
  const list = areas(role);
  const todo = todoItems(role, waiting);

  const todoText = (i: TodoItem) => ({
    title: i.id === 'terms' ? t('admin.todo.terms') : t(`admin.todo.${i.id}`, { n: i.count }),
    status: i.id === 'terms' ? t('admin.todo.termsSub') : i.id === 'linkHints' ? t('admin.todo.linkHintsSub') : undefined,
    badge: i.id === 'requests' ? i.count : undefined,
  });
  const goTodo = (i: TodoItem) => onGo(i.target === 'overview' ? 'approvals' : i.target);

  const badgeOf = (r: AreaRow): number | undefined => (r.badge === 'requests' ? waiting.requests : r.badge === 'linkHints' ? waiting.linkHints : r.badge === 'groupRequests' ? waiting.groupRequests : 0) || undefined;
  const nextS = data?.weeks ? nextSimcha(data.weeks) : null;
  const simchaText = nextS ? `${simchaTitle(nextS.item, t)}${nextS.item.surname ? `, ${t('simchas.family', { surname: nextS.item.surname })}` : ''}` : null;
  const prayersStatus = data?.schedule
    ? data.schedule.saved
      ? `${parasha ? t('admin.status.prayers', { parasha }) : ''}${data.schedule.updatedAt ? `${parasha ? ' · ' : ''}${t('admin.status.updated', { date: date(Math.floor(data.schedule.updatedAt / 1000)) })}` : ''}` || undefined
      : t('admin.status.prayersNone')
    : undefined;
  const areaStatus = (id: AreaId): string | undefined => {
    if (!data) return undefined;
    switch (id) {
      case 'prayers': return prayersStatus;
      case 'seats': return waiting.linkHints > 0 ? t('admin.todo.linkHints', { n: waiting.linkHints }) : undefined;
      case 'messages': return data.channels !== null ? t('admin.status.channels', { n: data.channels }) : undefined;
      case 'simchas': return simchaText ? t(nextS!.thisWeek ? 'simchas.card.this' : 'simchas.card.later', { text: simchaText }) : data.weeks ? t('admin.status.simchaNone') : undefined;
      case 'people': return t('admin.status.members', { m: data.members, l: data.listeners });
      default: return t('admin.status.settings');
    }
  };
  const rowStatus = (r: AreaRow): { status?: string; value?: string } => {
    const sub = (key: string) => t(`admin.rowSub.${key}`);
    switch (r.id) {
      case 'schedule': return { status: prayersStatus };
      case 'sheet': case 'print': case 'behalf': case 'responses': case 'editor': case 'compose': case 'types': case 'pushTexts': case 'aliyot': case 'members': case 'tags': case 'import': return { status: sub(r.id) };
      case 'holders': return { status: waiting.linkHints > 0 ? t('seatHolders.card.hints', { n: waiting.linkHints }) : undefined };
      case 'channels': return { status: data?.channels != null ? t('admin.status.channels', { n: data.channels }) : undefined };
      case 'simchas': return { status: simchaText ?? undefined };
      case 'groups': return { status: data?.groups != null ? t('admin.status.groups', { n: data.groups }) : undefined };
      case 'invite': return { status: data?.invites != null ? t('admin.status.invites', { n: data.invites }) : undefined };
      case 'cap': return { value: data?.cap !== undefined ? `${data.listeners} / ${data.cap}` : undefined };
      case 'privacy': return { status: data ? data.contact || t('admin.status.privacyNone') : undefined };
      case 'terms': return { status: data?.terms ? t('admin.status.terms', { date: termsDate(lang, data.terms.at), name: data.terms.name }) : undefined };
      default: return {};
    }
  };
  const open = (r: AreaRow) => {
    if (!r.target) return undefined;
    if (r.target === 'sheet:cap') return () => setSheet('cap');
    if (r.target === 'sheet:privacy') return () => setSheet('privacy');
    if (r.target === 'sheet:terms') return () => setSheet('terms');
    const target = r.target;
    return () => onGo(target);
  };
  const row = (r: AreaRow) => {
    const s = rowStatus(r);
    return <NavRow key={r.id} icon={ROW_ICON[r.id]} title={t(`admin.row.${r.id}`)} status={s.status} value={s.value} badge={badgeOf(r)} tone={r.id === 'holders' && waiting.linkHints > 0 ? 'attention' : undefined} onPress={open(r)} />;
  };

  const sheets = (
    <>
      <CapSheet visible={sheet === 'cap'} cap={data?.cap} listeners={data?.listeners} onClose={() => setSheet(null)} onSaved={() => { onToast(t('admin.overview.cap.saved')); void reload(); }} />
      <PrivacyContactSheet visible={sheet === 'privacy'} contact={data?.contact ?? ''} onClose={() => setSheet(null)} onSaved={() => { onToast(t('admin.overview.privacy.saved')); void reload(); void refreshKehila(); }} />
      <TermsSheet visible={sheet === 'terms'} accepted={data?.terms} onClose={() => setSheet(null)} />
    </>
  );
  const frame = { padding: 16, gap: 16, width: '100%', maxWidth: wide ? 1200 : 680, alignSelf: 'center' } as const;

  // A group screen (P42 phone 2): back "› סקירה", then list groups of rows.
  const current = area ? list.find(a => a.id === area) : undefined;
  if (area && current) {
    const sections = current.id === 'seats' ? (['week', 'hall'] as const).map(s => ({ label: t(`admin.section.${s}`), rows: current.rows.filter(r => r.section === s) })) : [{ label: undefined, rows: current.rows }];
    return (
      <PadScroll contentContainerStyle={frame}>
        <BackLink onPress={onBack} label={t('admin.area.back')} />
        <Txt serif size="title" accessibilityRole="header">{t(`admin.area.${current.id}`)}</Txt>
        {error ? <Banner tone="error" text={error} /> : null}
        <View style={{ gap: 16, maxWidth: 680, width: '100%' }}>
          {sections.map((s, i) => <ListGroup key={i} label={s.label}>{s.rows.map(row)}</ListGroup>)}
        </View>
        {sheets}
      </PadScroll>
    );
  }

  const todoCard = todo.length > 0 ? (
    wide ? (
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {todo.slice(0, 3).map(i => {
          const x = todoText(i);
          return <View key={i.id} style={{ flex: 1, backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, borderStartWidth: 6, borderStartColor: k.pomegranate, overflow: 'hidden' }}><NavRow title={x.title} status={x.status} badge={x.badge} onPress={() => goTodo(i)} /></View>;
        })}
      </View>
    ) : (
      <Card edgeColor={k.pomegranate} style={{ padding: 0, overflow: 'hidden' }}>
        {todo.map((i, n) => { const x = todoText(i); return <View key={i.id} style={n > 0 ? { borderTopWidth: 1, borderTopColor: k.line } : undefined}><NavRow title={x.title} status={x.status} badge={x.badge} onPress={() => goTodo(i)} /></View>; })}
      </Card>
    )
  ) : <Txt color={k.muted}>{t('admin.todo.none')}</Txt>;

  return (
    <PadScroll contentContainerStyle={frame}>
      <Txt serif size="title" accessibilityRole="header">{t('admin.overview.title')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {!data ? <ActivityIndicator color={k.tekhelet} /> : null}
      {data ? (
        <>
          <View style={{ gap: 8 }}>
            {todo.length > 0 ? <Txt size="small" bold color={k.muted} accessibilityRole="header" style={{ marginHorizontal: 4 }}>{t('admin.todo.title')}</Txt> : null}
            {todoCard}
          </View>
          <View style={{ gap: 8 }}>
            <Txt size="small" bold color={k.muted} accessibilityRole="header" style={{ marginHorizontal: 4 }}>{t('admin.area.label')}</Txt>
            {wide ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {list.map(a => <GridCard key={a.id} area={a} status={areaStatus(a.id)} onOpen={() => onArea(a.id)} badge={(r: AreaRow) => badgeOf(r)} open={open} />)}
              </View>
            ) : (
              <ListGroup>
                {AREA_IDS.filter(id => list.some(a => a.id === id)).map(id => (
                  <NavRow key={id} big icon={AREA_ICON[id]} title={t(`admin.area.${id}`)} status={areaStatus(id)}
                    tone={id === 'seats' && waiting.linkHints > 0 ? 'attention' : undefined} onPress={() => onArea(id)} />
                ))}
              </ListGroup>
            )}
          </View>
        </>
      ) : null}
      {sheets}
    </PadScroll>
  );
}

/** Wide overview: one card per group with its status line and its rows (one click from the overview to every tool). */
function GridCard({ area, status, onOpen, badge, open }: { area: Area; status: string | undefined; onOpen: () => void; badge: (r: AreaRow) => number | undefined; open: (r: AreaRow) => (() => void) | undefined }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <View style={{ flexBasis: '31%', flexGrow: 1, minWidth: 280, backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, padding: 16, gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={status ? `${t(`admin.area.${area.id}`)}. ${status}` : t(`admin.area.${area.id}`)} onPress={onOpen} style={{ gap: 2, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name={AREA_ICON[area.id]} size={24} color={k.tekhelet} />
          <Txt serif size="heading" style={{ flex: 1 }}>{t(`admin.area.${area.id}`)}</Txt>
        </View>
        {status ? <Txt size="small" color={k.muted} numberOfLines={1}>{status}</Txt> : null}
      </Pressable>
      {area.rows.map(r => <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: k.line }}><MiniRow title={t(`admin.row.${r.id}`)} badge={badge(r)} onPress={open(r)} /></View>)}
    </View>
  );
}
