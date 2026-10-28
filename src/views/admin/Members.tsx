import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { keyedFlight } from '../../client/singleFlight.ts';
import { familyLine, existingGroups } from '../../client/membersView.ts';
import { config } from '../../config.ts';
import { fixtureParams } from '../../client/fixtures.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import { bulkCount, filterMembers } from '../../client/membersView.ts';
import type { AdminFamily, Classification, Group, MemberFields, MemberRow, Role, TagRow } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { textStart } from '../../i18n/direction.ts';
import { Banner, Button, Card, Chip, Sheet, Tag, Toggle, Txt, useTokens } from '../../kit/components.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { TOUCH, fonts, type } from '../../kit/theme.ts';
import { WIDE, useAdminErrText } from './shared.tsx';
import { FamilyBlock } from './FamilyBlock.tsx';
import { LinkSheet } from './LinkSheet.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { TagChips } from '../TagChips.tsx';
import { AssignTagsSheet, ManageTagsSheet, TextLink } from './Tags.tsx';
import { assignmentBody } from '../../client/tagsView.ts';

const CLASS_KEY: Record<string, string> = { '': 'none', 'א': 'a', 'קבוע': 'kavua' };

/** The groups sheet of one person: toggle chips, save → updateMember({groups}). */
function GroupsSheet({ row, groups, onClose, onSave }: { row: MemberRow | null; groups: Group[]; onClose: () => void; onSave: (ids: string[]) => Promise<string | null> }) {
  const { t } = useI18n();
  const [ids, setIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setIds(existingGroups(row?.groups ?? [], groups.map(g => g.groupId))); setError(null); }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (g: string) => setIds(cur => (cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g]));
  return (
    <Sheet visible={!!row} title={t('admin.members.groupsTitle', { name: row?.displayName ?? '' })} onClose={onClose}>
      {groups.length === 0 ? <Txt>{t('admin.members.groupsNone')}</Txt> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {groups.map(g => <Chip size="filter" key={g.groupId} label={g.name} selected={ids.includes(g.groupId)} onPress={() => toggle(g.groupId)} />)}
        </View>
      )}
      {error ? <Banner tone="error" text={error} /> : null}
      {groups.length > 0 ? <Button title={t('admin.members.groupsSave')} busy={busy} onPress={() => { setBusy(true); void onSave(ids).then(e => { setBusy(false); if (e) setError(e); }); }} /> : null}
    </Sheet>
  );
}

/** Actions of one person: role, classification, groups, remove (confirmed). */
function Actions({ row, error, busy, family, alone, onFields, onGroups, onLink, onRemove, onTree }: {
  row: MemberRow; error: string | null; busy: boolean; family: AdminFamily | undefined; alone: boolean;
  onFields: (f: MemberFields) => void; onGroups: () => void; onLink: () => void; onRemove: () => Promise<void>; onTree?: () => void;
}) {
  const { t } = useI18n();
  const [asking, setAsking] = React.useState(false);
  const flip: Role = row.role === 'gabbai' ? 'member' : 'gabbai';
  return (
    <View style={{ gap: 8, paddingTop: 8 }}>
      {error ? <Banner tone="error" text={error} /> : null}
      {row.role !== 'listener' ? (
        <>
          <FamilyBlock family={family} onTree={onTree} />
          {alone ? <Button kind="secondary" title={t('admin.members.link')} onPress={onLink} /> : null}
          <Button kind="secondary" title={row.role === 'gabbai' ? t('admin.members.makeMember') : t('admin.members.makeGabbai')} busy={busy} onPress={() => onFields({ role: flip })} />
          <Txt size="small" bold>{t('admin.members.class.label')}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['', 'א', 'קבוע'] as Classification[]).map(c => (
              <Chip size="filter" key={c} label={t(`admin.members.class.${CLASS_KEY[c]}`)} selected={row.classification === c} onPress={() => { if (row.classification !== c) onFields({ classification: c }); }} />
            ))}
          </View>
          <Button kind="secondary" title={t('admin.members.groups')} onPress={onGroups} />
        </>
      ) : null}
      {asking ? (
        <View style={{ gap: 8 }}>
          <Txt size="small">{t('admin.members.removeConfirm', { name: row.displayName })}</Txt>
          <Button kind="danger" title={t('admin.members.removeYes')} busy={busy} onPress={() => void onRemove().then(() => setAsking(false))} />
          <Button kind="secondary" title={t('admin.members.keep')} onPress={() => setAsking(false)} disabled={busy} />
        </View>
      ) : <Button kind="secondary" title={t('admin.members.remove')} onPress={() => setAsking(true)} />}
    </View>
  );
}

/** GM4 (cards) below 1024 px, GD1 (table) from 1024 px: members, roles and the broadcast right. */
export function Members({ onToast, onTree }: { onToast: (text: string) => void; /** Opens one family's tree, read only. */ onTree?: (familyId: string, name: string) => void }) {
  const { t, lang, dir } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const kehilaId = state.kehilaId!;
  const [rows, setRows] = React.useState<MemberRow[] | null>(null);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [role, setRole] = React.useState<Role | undefined>(undefined);
  const [send, setSend] = React.useState<boolean | undefined>(undefined);
  const [group, setGroup] = React.useState<string | undefined>(undefined);
  const fxScreen = config.fixtures ? fixtureParams().screen : undefined; // frame P11: דנה open, or the link sheet of מיכל
  const [open, setOpen] = React.useState<string | null>(fxScreen === 'admin-families' ? '01FIXTUREUSER00000000021' : null);
  const [rowError, setRowError] = React.useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [bulk, setBulk] = React.useState<boolean | null>(null);
  const [groupsFor, setGroupsFor] = React.useState<string | null>(null);
  const [families, setFamilies] = React.useState<AdminFamily[]>([]);
  const [linkFor, setLinkFor] = React.useState<string | null>(fxScreen === 'admin-link' ? '01FIXTUREUSER00000000023' : null);
  const [tagRows, setTagRows] = React.useState<TagRow[]>([]);
  const [tagsError, setTagsError] = React.useState<string | null>(null);
  const [manageTags, setManageTags] = React.useState(fxScreen === 'tags-manage' || fxScreen === 'tags-empty');
  const [tagsFor, setTagsFor] = React.useState<string | null>(fxScreen === 'tags-assign' ? 'm1' : null);
  const flight = React.useRef(keyedFlight()).current;

  const load = React.useCallback(async () => {
    const [m, g, f, tg] = await Promise.allSettled([api.members(kehilaId), api.groups(kehilaId), api.adminFamilies(kehilaId), api.tags(kehilaId)]);
    if (m.status === 'fulfilled') { setRows(m.value); setError(null); } else { setError(errText(m.reason)); setRows(prev => prev ?? []); }
    if (g.status === 'fulfilled') setGroups(g.value);
    if (f.status === 'fulfilled') setFamilies(f.value);
    if (tg.status === 'fulfilled') { setTagRows(tg.value); setTagsError(null); } else setTagsError(errText(tg.reason));
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); }, [load]);

  const groupNames = React.useMemo(() => new Map(groups.map(g => [g.groupId, g.name])), [groups]);
  const all = rows ?? [];
  const shown = filterMembers(all, { query, role, canBroadcast: send, group });
  const patch = (u: string, f: MemberFields) => setRows(cur => (cur ?? []).map(r => (r.userId === u ? { ...r, ...f } : r)));

  /** Returns the error text, or null on success. */
  async function update(u: string, f: MemberFields, done = t('admin.members.saved')): Promise<string | null> {
    let out: string | null = null;
    await flight(u, async () => {
      setBusy(u); setRowError(null);
      try { await api.updateMember(kehilaId, u, f); patch(u, f); onToast(done); }
      catch (e) { out = errText(e); setRowError({ id: u, text: out }); }
      finally { setBusy(null); }
    });
    return out;
  }
  /** Returns the error text, or null on success. */
  async function saveTags(u: string, ids: string[]): Promise<string | null> {
    let out: string | null = null;
    await flight(u, async () => {
      try {
        const r = await api.setMemberTags(kehilaId, u, assignmentBody(ids, tagRows).tagIds);
        setRows(cur => (cur ?? []).map(x => (x.userId === u ? { ...x, tags: r.tags } : x)));
        setTagsFor(null); onToast(t('admin.tags.assign.saved'));
        void load(); // counts in the tag list
      } catch (e) {
        out = errText(e);
        const code = (e as { code?: unknown } | null)?.code;
        if (code === 'invalid_tag_ids' || code === 'tag_not_found') void load(); // the list changed under us: show the current one
      }
    });
    return out;
  }
  async function remove(u: string) {
    await flight(u, async () => {
      setBusy(u); setRowError(null);
      try { await api.removeMember(kehilaId, u); setRows(cur => (cur ?? []).filter(r => r.userId !== u)); setOpen(null); onToast(t('admin.members.removed')); }
      catch (e) { setRowError({ id: u, text: errText(e) }); } finally { setBusy(null); }
    });
  }
  async function doBulk(allow: boolean) {
    await flight('bulk', async () => {
      setBusy('bulk'); setError(null);
      try {
        await api.setBroadcastAll(kehilaId, allow);
        setRows(cur => (cur ?? []).map(r => (r.role === 'member' ? { ...r, canBroadcast: allow } : r)));
        setBulk(null); onToast(t('admin.members.bulkDone'));
      } catch (e) { setError(errText(e)); setBulk(null); } finally { setBusy(null); }
    });
  }

  const sendSwitch = (r: MemberRow) => (r.role === 'member'
    ? <Toggle label={t('admin.members.broadcast')} value={r.canBroadcast} onChange={v => void update(r.userId, { canBroadcast: v })} />
    : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="lock" size={16} color={k.muted} /><Txt size="small" color={k.muted}>{t('admin.members.locked')}</Txt></View>);
  const chips = (r: MemberRow) => (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {r.groups.map(g => groupNames.get(g)).filter((n): n is string => !!n).map(n => <Tag key={n} label={n} />)}
    </View>
  );
  const tagLine = (r: MemberRow) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Txt size="small" color={k.muted}>{t('admin.tags.member.caption')}</Txt>
        {r.tags.length ? <TagChips tags={r.tags} /> : <Txt size="small" color={k.muted}>{t('admin.tags.member.none')}</Txt>}
      </View>
      <TextLink title={t('admin.tags.member.edit')} disabled={!!tagsError} accessibilityLabel={t('admin.tags.member.editA11y', { name: r.displayName })} onPress={() => setTagsFor(r.userId)} />
    </View>
  );
  const familyOf = (u: string) => families.find(f => f.adults.some(a => a.userId === u));
  const famText = (r: MemberRow) => {
    if (r.role === 'listener') return null;
    const l = familyLine(r.userId, families);
    return `${l.partnerName ? t('admin.members.familyWith', { name: l.partnerName }) : t('admin.members.familyAlone')} · ${t('admin.members.children', { n: l.children })}`;
  };
  const actions = (r: MemberRow) => open === r.userId ? (
    <Actions row={r} family={familyOf(r.userId)} alone={(familyOf(r.userId)?.adults.length ?? 1) < 2} onLink={() => setLinkFor(r.userId)} busy={busy === r.userId} error={rowError?.id === r.userId ? rowError.text : null}
      onFields={f => void update(r.userId, f)} onGroups={() => setGroupsFor(r.userId)} onRemove={() => remove(r.userId)}
      onTree={onTree && familyOf(r.userId) ? () => onTree(familyOf(r.userId)!.familyId, familyOf(r.userId)!.name) : undefined} />
  ) : null;
  const toggleOpen = (r: MemberRow) => { setOpen(o => (o === r.userId ? null : r.userId)); setRowError(null); };

  const filters = (
    <View style={{ gap: 8 }}>
      <TextInput accessibilityLabel={t('admin.members.search')} placeholder={t('admin.members.search')} placeholderTextColor={k.muted} value={query} onChangeText={setQuery}
        style={{ minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip size="filter" label={t('admin.members.filter.all')} selected={role === undefined} onPress={() => setRole(undefined)} />
        <Chip size="filter" label={t('admin.members.filter.member')} selected={role === 'member'} onPress={() => setRole('member')} />
        <Chip size="filter" label={t('admin.members.filter.gabbai')} selected={role === 'gabbai'} onPress={() => setRole('gabbai')} />
        <Chip size="filter" label={t('admin.members.filter.listener')} selected={role === 'listener'} onPress={() => setRole('listener')} />
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip size="filter" label={t('admin.members.filter.can')} selected={send === true} onPress={() => setSend(s => (s === true ? undefined : true))} />
        <Chip size="filter" label={t('admin.members.filter.cannot')} selected={send === false} onPress={() => setSend(s => (s === false ? undefined : false))} />
      </ScrollView>
      {groups.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip size="filter" label={t('admin.members.filter.anyGroup')} selected={group === undefined} onPress={() => setGroup(undefined)} />
          {groups.map(g => <Chip size="filter" key={g.groupId} label={g.name} selected={group === g.groupId} onPress={() => setGroup(g.groupId)} />)}
        </ScrollView>
      ) : null}
    </View>
  );

  const bulkBar = (
    <Card>
      {bulk === null ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140 }}><Button kind="secondary" title={t('admin.members.bulkAllow')} onPress={() => setBulk(true)} /></View>
          <View style={{ flex: 1, minWidth: 140 }}><Button kind="secondary" title={t('admin.members.bulkBlock')} onPress={() => setBulk(false)} /></View>
        </View>
      ) : bulkCount(all, bulk) === 0 ? (
        <>
          <Txt>{t('admin.members.bulkNone')}</Txt>
          <Button kind="secondary" title={t('admin.members.keep')} onPress={() => setBulk(null)} />
        </>
      ) : (
        <>
          <Txt>{t(bulk ? 'admin.members.bulkAllowConfirm' : 'admin.members.bulkBlockConfirm', { n: bulkCount(all, bulk) })}</Txt>
          <Button title={t('admin.members.bulkYes')} busy={busy === 'bulk'} onPress={() => void doBulk(bulk)} />
          <Button kind="secondary" title={t('admin.members.keep')} onPress={() => setBulk(null)} disabled={busy === 'bulk'} />
        </>
      )}
    </Card>
  );

  const head = (label: string, flex: number) => <Txt size="small" bold color={k.muted} style={{ flex }}>{label}</Txt>;
  const body = wide ? (
    <View style={{ backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line }}>
      <View style={{ flexDirection: 'row', gap: 12, padding: 12, borderBottomWidth: 1, borderBottomColor: k.line }}>
        {head(t('admin.members.colName'), 3)}{head(t('admin.members.colRole'), 1.2)}{head(t('admin.members.colClass'), 1.2)}{head(t('admin.members.family'), 3)}{head(t('admin.members.colGroups'), 3)}{head(t('admin.tags.column'), 3)}{head(t('admin.members.colSend'), 2)}
        <View style={{ width: 120 }} />
      </View>
      {shown.map(r => (
        <View key={r.userId} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: k.line }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Txt bold style={{ flex: 3 }}>{r.displayName}</Txt>
            <View style={{ flex: 1.2, alignItems: 'flex-start' }}><Tag label={t(`admin.members.role.${r.role}`)} tone={r.role === 'gabbai' ? 'strong' : 'plain'} /></View>
            <Txt style={{ flex: 1.2 }}>{r.classification ? t(`admin.members.class.${CLASS_KEY[r.classification]}`) : '–'}</Txt>
            <Txt size="small" style={{ flex: 3 }}>{famText(r) ?? '–'}</Txt>
            <View style={{ flex: 3 }}>{r.groups.length ? chips(r) : <Txt size="small" color={k.muted}>{t('admin.members.noGroups')}</Txt>}</View>
            <View style={{ flex: 3 }}>{tagLine(r)}</View>
            <View style={{ flex: 2 }}>{sendSwitch(r)}</View>
            <View style={{ width: 120 }}><Button kind="secondary" title={t('admin.members.details')} onPress={() => toggleOpen(r)} /></View>
          </View>
          {actions(r)}
        </View>
      ))}
    </View>
  ) : (
    <View style={{ gap: 12 }}>
      {shown.map(r => (
        <Card key={r.userId}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === r.userId }} onPress={() => toggleOpen(r)} style={{ minHeight: TOUCH, justifyContent: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Txt bold size="heading" style={{ flexShrink: 1 }}>{r.displayName}</Txt>
              <Tag label={t(`admin.members.role.${r.role}`)} tone={r.role === 'gabbai' ? 'strong' : 'plain'} />
              {r.classification ? <Tag label={t(`admin.members.class.${CLASS_KEY[r.classification]}`)} /> : null}
            </View>
            {famText(r) ? <Txt size="small" color={k.muted}>{famText(r)}</Txt> : null}
            {chips(r)}
          </Pressable>
          {tagLine(r)}
          {sendSwitch(r)}
          {actions(r)}
        </Card>
      ))}
    </View>
  );

  const linking = all.find(r => r.userId === linkFor) ?? null;
  const editing = all.find(r => r.userId === groupsFor) ?? null;
  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: wide ? 1200 : 680, alignSelf: 'center' }}>
      <Txt serif size="title" accessibilityRole="header">{t('admin.members.title')}</Txt>
      <Button kind="secondary" icon="edit" title={t('admin.tags.button')} onPress={() => setManageTags(true)} />
      {error ? <Banner tone="error" text={error} /> : null}
      {tagsError ? <Banner tone="error" text={tagsError} action={{ title: t('common.retry'), onPress: () => void load() }} /> : null}
      {filters}
      {bulkBar}
      {rows === null ? <ActivityIndicator color={k.tekhelet} /> : <Txt size="small" color={k.muted}>{t('admin.members.count', { n: shown.length })}</Txt>}
      {rows && shown.length === 0 ? <Txt color={k.muted}>{t('admin.members.empty')}</Txt> : body}
      <GroupsSheet row={editing} groups={groups} onClose={() => setGroupsFor(null)}
        onSave={async ids => { const e = await update(groupsFor!, { groups: ids }, t('admin.members.groupsSaved')); if (!e) setGroupsFor(null); return e; }} />
      <ManageTagsSheet visible={manageTags} kehilaId={kehilaId} onClose={() => setManageTags(false)} onChanged={() => void load()} onToast={onToast} />
      <AssignTagsSheet row={all.find(r => r.userId === tagsFor) ?? null} tags={tagRows} onClose={() => setTagsFor(null)} onManage={() => { setTagsFor(null); setManageTags(true); }} onSave={ids => saveTags(tagsFor!, ids)} />
      <LinkSheet person={linking} members={all} families={families} kehilaId={kehilaId} onClose={() => setLinkFor(null)}
        onLinked={() => { setLinkFor(null); onToast(t('admin.link.done')); void load(); }} />
    </PadScroll>
  );
}
