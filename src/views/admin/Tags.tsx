import React from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { TAG_NAME_MAX, assignmentBody, canAddTag, sortTags, starterToOffer, toggleId, validateTagName } from '../../client/tagsView.ts';
import type { MemberRow, RoleTag, TagRow } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Check, Chip, Field, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { useAdminErrText } from './shared.tsx';

/** Link-style 48-high pressable. */
export function TextLink({ title, onPress, accessibilityLabel, disabled }: { title: string; onPress: () => void; accessibilityLabel?: string; disabled?: boolean }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? title} disabled={disabled} accessibilityState={{ disabled: !!disabled }} onPress={onPress} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start', opacity: disabled ? 0.5 : 1 }}>
      <Txt size="small" bold color={k.tekhelet}>{title}</Txt>
    </Pressable>
  );
}

function IconButton({ icon, label, onPress, disabled }: { icon: 'edit' | 'trash'; label: string; onPress: () => void; disabled?: boolean }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={{ top: 2, bottom: 2 }}
      style={{ width: 48, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      <Icon name={icon} size={22} color={k.ink} />
    </Pressable>
  );
}

/** "תגיות תפקיד": add, rename and delete the Kehila's tags; each change saves at once. The starter set shows when the sheet opens on an empty list. */
export function ManageTagsSheet({ visible, kehilaId, onClose, onChanged, onToast }: {
  visible: boolean; kehilaId: string; onClose: () => void; /** After any change: the members list should reload. */ onChanged: () => void; onToast: (text: string) => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const errText = useAdminErrText();
  const [tags, setTags] = React.useState<TagRow[] | null>(null);
  const [startedEmpty, setStartedEmpty] = React.useState(false);
  const [name, setName] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; text: string } | null>(null);
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    let live = true;
    setTags(null); setName(''); setFieldError(null); setError(null); setRenaming(null); setDeleting(null);
    api.tags(kehilaId).then(r => { if (live) { setTags(r); setStartedEmpty(r.length === 0); } }, e => { if (live) { setError(errText(e)); setTags([]); setStartedEmpty(false); } });
    return () => { live = false; };
  }, [visible, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = tags ?? [];
  const reason = (e: 'required' | 'tooLong' | 'duplicate' | 'invalid') => (e === 'required' ? t('admin.tags.required') : e === 'duplicate' ? t('admin.tags.duplicate') : t('errors.invalid_tag_name'));

  async function run(work: () => Promise<void>, setErr: (s: string) => void) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  const add = (raw: string, clear: boolean) => {
    const v = validateTagName(raw, list);
    if (!v.ok) { setFieldError(reason(v.error)); return; }
    setFieldError(null);
    void run(async () => {
      const created = await api.createTag(kehilaId, v.name);
      setTags(cur => [...(cur ?? []), { ...created, memberCount: 0 }]);
      if (clear) setName('');
      onToast(t('admin.tags.added'));
    }, setFieldError);
  };
  const rename = () => {
    if (!renaming) return;
    const v = validateTagName(renaming.text, list, renaming.id);
    if (!v.ok) { setRenameError(reason(v.error)); return; }
    setRenameError(null);
    void run(async () => {
      await api.renameTag(kehilaId, renaming.id, v.name);
      setTags(cur => (cur ?? []).map(x => (x.tagId === renaming.id ? { ...x, name: v.name } : x)));
      setRenaming(null); onToast(t('admin.tags.renamed'));
    }, setRenameError);
  };
  const del = (id: string) => void run(async () => {
    await api.deleteTag(kehilaId, id);
    setTags(cur => (cur ?? []).filter(x => x.tagId !== id));
    setDeleting(null); onToast(t('admin.tags.deleted'));
  }, setError);

  const offers = starterToOffer(t('admin.tags.suggest').split(/\s*,\s*/), list, startedEmpty);
  const full = !canAddTag(list);
  return (
    <Sheet visible={visible} title={t('admin.tags.title')} onClose={onClose}>
      <Txt size="small" color={k.muted}>{t('admin.tags.intro')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      {tags === null ? <Txt size="small" color={k.muted}>{t('common.loading')}</Txt> : null}
      {tags !== null && offers.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Txt bold>{t('admin.tags.emptyStart')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {offers.map(s => <Chip key={s} size="filter" suggest icon="plus" label={s} accessibilityLabel={t('admin.tags.suggestA11y', { name: s })} onPress={() => add(s, false)} />)}
          </View>
        </View>
      ) : null}
      {list.length > 0 ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Txt bold>{t('admin.tags.listTitle')}</Txt>
            <Txt size="small" color={k.muted}>{t('admin.tags.count', { n: list.length })}</Txt>
          </View>
          {sortTags(list).map(x => (
            <View key={x.tagId} style={{ borderTopWidth: 1, borderTopColor: k.line, paddingVertical: 4, gap: 8 }}>
              {renaming?.id === x.tagId ? (
                <View style={{ gap: 8 }}>
                  <Field label={t('admin.tags.renameField')} value={renaming.text} onChangeText={v => setRenaming({ id: x.tagId, text: v })} maxCodePoints={TAG_NAME_MAX} error={renameError} />
                  <Button title={t('admin.tags.save')} busy={busy} onPress={rename} />
                  <Button kind="secondary" title={t('admin.tags.cancel')} disabled={busy} onPress={() => { setRenaming(null); setRenameError(null); }} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ flex: 1, minHeight: TOUCH, justifyContent: 'center' }}>
                    <Txt bold content>{x.name}</Txt>
                    <Txt size="caption" color={k.muted}>{x.memberCount === 1 ? t('admin.tags.peopleOne') : t('admin.tags.people', { n: x.memberCount })}</Txt>
                  </View>
                  <IconButton icon="edit" label={t('admin.tags.renameA11y', { name: x.name })} disabled={busy} onPress={() => { setRenaming({ id: x.tagId, text: x.name }); setRenameError(null); setDeleting(null); }} />
                  <IconButton icon="trash" label={t('admin.tags.deleteA11y', { name: x.name })} disabled={busy} onPress={() => { setDeleting(x.tagId); setRenaming(null); }} />
                </View>
              )}
              {deleting === x.tagId ? (
                <View style={{ gap: 8 }}>
                  <Banner text={t(x.memberCount > 0 ? 'admin.tags.deleteConfirm' : 'admin.tags.deleteConfirmNone', { name: x.name, n: x.memberCount })} />
                  <Button kind="danger" title={t('admin.tags.deleteYes')} busy={busy} onPress={() => del(x.tagId)} />
                  <Button kind="secondary" title={t('admin.tags.cancel')} disabled={busy} onPress={() => setDeleting(null)} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {tags !== null ? (full ? <Banner text={t('admin.tags.limit')} /> : (
        <View style={{ gap: 8 }}>
          <Field label={t('admin.tags.newField')} value={name} onChangeText={v => { setName(v); setFieldError(null); }} maxCodePoints={TAG_NAME_MAX} error={fieldError} />
          <Button title={t('admin.tags.add')} busy={busy} disabled={!name.trim()} onPress={() => add(name, true)} />
        </View>
      )) : null}
    </Sheet>
  );
}

/** "התגיות של {name}": one checkbox per Kehila tag; saved with the footer button. Closing with changes asks first. */
export function AssignTagsSheet({ row, tags, onClose, onManage, onSave }: {
  row: MemberRow | null; tags: TagRow[]; onClose: () => void; onManage: () => void; onSave: (ids: string[]) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const [ids, setIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [discard, setDiscard] = React.useState(false);
  const start = (row?.tags ?? []).map(x => x.tagId);
  React.useEffect(() => { setIds(start); setError(null); setDiscard(false); }, [row?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!row && (ids.length !== start.length || ids.some(i => !start.includes(i)));
  const close = () => { if (dirty && !busy) setDiscard(true); else onClose(); };
  const footer = tags.length === 0 ? undefined : discard ? (
    <>
      <Banner text={t('admin.tags.discardConfirm')} />
      <Button kind="danger" title={t('admin.tags.discardYes')} onPress={onClose} />
      <Button kind="secondary" title={t('admin.tags.back')} onPress={() => setDiscard(false)} />
    </>
  ) : (
    <Button title={t('admin.tags.save')} busy={busy} onPress={() => { setBusy(true); void onSave(assignmentBody(ids, tags).tagIds).then(e => { setBusy(false); if (e) setError(e); }); }} />
  );
  return (
    <Sheet visible={!!row} title={t('admin.tags.assign.title', { name: row?.displayName ?? '' })} onClose={close} footer={footer}>
      {tags.length === 0 ? <Txt>{t('admin.tags.assign.empty')}</Txt> : (
        <View>{sortTags(tags).map(x => <Check key={x.tagId} label={x.name} value={ids.includes(x.tagId)} onChange={() => setIds(cur => toggleId(cur, x.tagId))} />)}</View>
      )}
      <TextLink title={t('admin.tags.assign.manage')} onPress={onManage} />
      <Txt size="small" color={k.muted}>{t('admin.tags.note')}</Txt>
      {error ? <Banner tone="error" text={error} /> : null}
    </Sheet>
  );
}
