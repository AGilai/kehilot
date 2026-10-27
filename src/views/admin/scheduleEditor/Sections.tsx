// The editor column (UX-DESIGN §14.2): one card per section, rows with grip, name, formula pill, computed time and menu; the builder opens
// under the selected row. Rows are list items with one tab stop each: arrows move between them, Enter opens, Esc closes, Alt+arrows move.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Button, Card, Field, Tag, Txt, useTokens } from '../../../kit/components.tsx';
import { Icon } from '../../../kit/Icon.tsx';
import { clockLabel, textIn } from '../../../schedule/memberView.ts';
import type { RowItem } from '../../../schedule/editor.ts';
import type { Formula, Section, Text, Time } from '../../../schedule/types.ts';
import { WeekTag } from '../../ScheduleRow.tsx';
import { ActionMenu, IconBtn } from './controls.tsx';
import type { Key } from './controls.tsx';
import { DropTarget, Grip } from './dnd.tsx';

export const itemKey = (item: RowItem) => (item.kind === 'row' ? `row:${item.row.id}` : `extra:${item.extra.id}`);

/** The short summary in a row's pill: "שקיעה · הכי מוקדם א׳–ה׳ · ‎−15 · למטה ל־5 · עד 18:30". */
export function useFormulaSummary(): (formula: Formula) => string {
  const { t } = useI18n();
  return f => {
    const parts = [`${t(`editor.anchors.${f.anchor}`)} · ${t(`editor.pillDay.${f.day}`)}`];
    if (f.offset.minutes) parts.push(`\u2066${f.offset.direction === 'before' ? '\u2212' : '+'}${f.offset.minutes}\u2069`);
    if (f.rounding.mode !== 'none') parts.push(t(`editor.pillRound.${f.rounding.mode}`, { step: f.rounding.step }));
    if (f.notEarlierThan) parts.push(t('editor.pillFrom', { time: `⁦${clockLabel(f.notEarlierThan)}⁩` }));
    if (f.notLaterThan) parts.push(t('editor.pillUntil', { time: `⁦${clockLabel(f.notLaterThan)}⁩` }));
    return parts.join(' · ');
  };
}

function Pill({ time, review }: { time: Time; review: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const summary = useFormulaSummary();
  const text = time.kind === 'formula' ? summary(time.formula) : time.kind === 'fixed' ? t('editor.kindFixed') : t('editor.pillText');
  const icon = time.kind === 'formula' ? 'sliders' : time.kind === 'fixed' ? 'clock' : 'msg';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: time.kind === 'formula' ? k.tekhelet : k.line, backgroundColor: time.kind === 'formula' ? k.surface : k.stone, flexShrink: 1 }}>
        <Icon name={icon} size={14} color={time.kind === 'formula' ? k.tekhelet : k.muted} />
        <Txt size="caption" bold color={time.kind === 'formula' ? k.tekhelet : k.muted} numberOfLines={1} style={{ flexShrink: 1 }}>{text}</Txt>
      </View>
      {review ? <Tag label={t('editor.toCheck')} tone="preview" /> : null}
    </View>
  );
}

type RowProps = {
  item: RowItem; first: boolean; selected: boolean; focusable: boolean; review: boolean; narrow: boolean; weekEditable: boolean;
  canUp: boolean; canDown: boolean; draggable: boolean; dropActive: boolean; dropOver: boolean;
  setRef: (node: unknown) => void;
  onPress: () => void; onKey: (key: Key) => void;
  onAction: (action: 'duplicate' | 'up' | 'down' | 'hide' | 'show' | 'delete') => void;
  onDragStart: () => void; onDragEnd: () => void; onDragOver: () => void; onDrop: () => void;
};

function EditorRow(p: RowProps) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { item } = p;
  const label: Text = item.kind === 'row' ? item.row.label : item.extra.label;
  const note = item.kind === 'row' ? item.row.note : item.extra.note;
  const time: Time = item.kind === 'row' ? item.row.time : item.extra.time;
  const hidden = item.kind === 'row' && item.hidden;
  const changed = item.kind === 'row' && item.override?.kind === 'time';
  const usual = item.kind === 'row' && changed ? item.computed?.usual ?? null : null;
  const shown = item.computed?.time ?? null;
  const name = textIn(label, lang) || t('editor.rowFallback');
  const noteLine = changed && item.kind === 'row' && item.override?.kind === 'time' && item.override.note ? item.override.note : note;
  const accent = changed || item.kind === 'extra';
  const menu = [
    { key: 'edit', label: t('editor.menuEdit'), icon: 'edit' as const, onPress: p.onPress },
    ...(item.kind === 'row' ? [{ key: 'duplicate', label: t('editor.duplicate'), icon: 'copy' as const, onPress: () => p.onAction('duplicate') }] : []),
    ...(item.kind === 'row' ? [
      { key: 'up', label: t('editor.moveUp'), icon: 'up' as const, onPress: () => p.onAction('up'), disabled: !p.canUp },
      { key: 'down', label: t('editor.moveDown'), icon: 'chev' as const, onPress: () => p.onAction('down'), disabled: !p.canDown },
      { key: 'hide', label: hidden ? t('editor.showAgain') : t('editor.hideThisWeek'), icon: 'eyeoff' as const, onPress: () => p.onAction(hidden ? 'show' : 'hide'), disabled: !p.weekEditable },
    ] : []),
    { key: 'delete', label: t('editor.deleteRow'), icon: 'trash' as const, onPress: () => p.onAction('delete'), danger: true },
  ];
  return (
    <DropTarget active={p.dropActive} onOver={p.onDragOver} onDrop={p.onDrop}>
      <Pressable ref={p.setRef as never} role="listitem" accessibilityLabel={`${name}${shown ? `, ${clockLabel(shown)}` : ''}`} accessibilityState={{ selected: p.selected }}
        onPress={p.onPress} {...({ tabIndex: p.focusable ? 0 : -1, onKeyDown: (e: unknown) => { const ev = e as { target?: unknown; currentTarget?: unknown; key?: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; preventDefault?: () => void }; if (ev.target !== ev.currentTarget) return; p.onKey({ key: ev.key ?? '', shift: !!ev.shiftKey, alt: !!ev.altKey, ctrl: !!ev.ctrlKey, meta: !!ev.metaKey, prevent: () => ev.preventDefault?.() }); } } as object)}
        style={{
          minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: p.narrow ? 8 : 10, paddingHorizontal: p.narrow ? 4 : 8, paddingVertical: 6,
          borderTopWidth: p.dropOver ? 3 : p.first ? 0 : 1, borderTopColor: p.dropOver ? k.tekhelet : k.line,
          backgroundColor: p.selected ? k.stone : accent && !hidden ? `${k.gold}10` : 'transparent',
          ...(p.selected ? { borderWidth: 2, borderColor: k.tekhelet, borderRadius: 8 } : null),
          ...(accent && !p.selected ? ({ borderStartWidth: 3, borderStartColor: k.gold, borderStyle: 'dashed' } as object) : null),
        }}>
        {p.narrow ? null : <Grip label={t('editor.grip')} color={k.muted} draggable={p.draggable} onDragStart={p.onDragStart} onDragEnd={p.onDragEnd} />}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Txt bold color={hidden ? k.muted : k.ink} style={{ flexShrink: 1, textDecorationLine: hidden ? 'line-through' : 'none' }} content>{name}</Txt>
            {hidden ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="eyeoff" size={14} color={k.gold} /><WeekTag label={t('editor.tagHidden')} /></View> : null}
            {item.kind === 'extra' ? <WeekTag label={t('editor.tagAdded')} /> : null}
            {changed ? <WeekTag label={usual ? t('editor.tagWeek', { time: `⁦${clockLabel(usual)}⁩` }) : t('schedule.thisWeek')} /> : null}
          </View>
          {noteLine ? <Txt size="caption" color={k.muted} numberOfLines={1} content>{noteLine}</Txt> : null}
          {p.narrow ? <Pill time={time} review={p.review} /> : null}
        </View>
        {p.narrow ? null : <Pill time={time} review={p.review} />}
        <Txt bold style={{ width: 64, textAlign: 'right', fontSize: 17, fontVariant: ['tabular-nums'], writingDirection: 'ltr' }} color={hidden || shown === null ? k.muted : k.ink}>
          {shown ? clockLabel(shown) : '—'}
        </Txt>
        {p.narrow ? <Icon name="back" size={18} color={k.muted} /> : <ActionMenu label={t('editor.more')} items={menu} />}
      </Pressable>
    </DropTarget>
  );
}

export type SectionCardProps = {
  section: Section; index: number; count: number; items: RowItem[]; overrideCount: number; summary: string;
  selectedKey: string | null; focusKey: string | null; review: Set<string>; collapsed: boolean; narrow: boolean; weekEditable: boolean;
  renderBuilder: (item: RowItem) => React.ReactNode;
  rowRefs: React.MutableRefObject<Map<string, unknown>>;
  onToggle: () => void; onSelect: (key: string) => void; onRowKey: (item: RowItem, key: Key) => void;
  onRename: (title: Text) => void; onMoveSection: (delta: number) => void; onDeleteSection: () => void;
  onAdd: (what: 'row' | 'text' | 'week') => void;
  onAction: (item: RowItem, action: 'duplicate' | 'up' | 'down' | 'hide' | 'show' | 'delete') => void;
  drag: { active: boolean; over: string | null; start: (rowId: string) => void; end: () => void; hover: (key: string | null) => void; drop: (sectionId: string, index: number) => void };
};

export function SectionCard(p: SectionCardProps) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const [renaming, setRenaming] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const { section } = p;
  const shabbat = section.kind === 'shabbat';
  const rowCount = section.rows.length;
  const rowItems = p.items.filter(i => i.kind === 'row');
  const menu = [
    { key: 'rename', label: t('editor.renameSection'), icon: 'edit' as const, onPress: () => setRenaming(true) },
    { key: 'up', label: t('editor.moveSectionUp'), icon: 'up' as const, onPress: () => p.onMoveSection(-1), disabled: p.index === 0 },
    { key: 'down', label: t('editor.moveSectionDown'), icon: 'chev' as const, onPress: () => p.onMoveSection(1), disabled: p.index === p.count - 1 },
    { key: 'delete', label: t('editor.deleteSection'), icon: 'trash' as const, onPress: () => setAsking(true), danger: true },
  ];
  const add = (icon: 'plus', text: string, what: 'row' | 'text' | 'week', gold?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={text} disabled={what === 'week' && !p.weekEditable} onPress={() => p.onAdd(what)}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, opacity: what === 'week' && !p.weekEditable ? 0.4 : 1 }}>
      <Icon name={icon} size={16} color={gold ? k.gold : k.tekhelet} />
      <Txt size="small" bold color={gold ? k.gold : k.tekhelet}>{text}</Txt>
    </Pressable>
  );
  return (
    <Card edgeColor={shabbat ? k.gold : k.tekhelet} style={{ padding: p.narrow ? 12 : 16, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, flexWrap: 'wrap' }}>
        <Txt serif size="heading" accessibilityRole="header" style={{ flexShrink: 1 }} content>{textIn(section.title, lang)}</Txt>
        <Tag label={shabbat ? t('editor.rowCount', { n: rowCount }) : t('editor.rowCountWeekday', { n: rowCount })} />
        {p.overrideCount ? <WeekTag label={t('editor.weekChanges', { n: p.overrideCount })} /> : null}
        <View style={{ flex: 1 }} />
        <IconBtn icon="edit" label={t('editor.renameSection')} onPress={() => setRenaming(r => !r)} />
        <ActionMenu label={t('editor.sectionMore')} items={menu} />
        <IconBtn icon="chev" label={p.collapsed ? t('editor.expand') : t('editor.collapse')} onPress={p.onToggle} />
      </View>
      {renaming ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', paddingBottom: 8 }}>
          <View style={{ flex: 1, minWidth: 200 }}><Field label={t('editor.sectionName')} value={section.title.he} maxCodePoints={60} onChangeText={he => p.onRename({ ...section.title, he })} /></View>
          <View style={{ flex: 1, minWidth: 200 }}><Field label={t('editor.sectionNameEn')} value={section.title.en ?? ''} maxCodePoints={60} ltr onChangeText={en => p.onRename({ he: section.title.he, en })} /></View>
          <Button kind="secondary" title={t('editor.done')} onPress={() => setRenaming(false)} />
        </View>
      ) : null}
      {asking ? (
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <Txt bold>{t('editor.deleteSectionAsk', { n: rowCount })}</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button kind="danger" title={t('editor.deleteYes')} onPress={() => { setAsking(false); p.onDeleteSection(); }} />
            <Button kind="secondary" title={t('common.cancel')} onPress={() => setAsking(false)} />
          </View>
        </View>
      ) : null}
      {p.collapsed ? (
        <Txt size="small" color={k.muted} style={{ paddingBottom: 8 }}>{p.summary}</Txt>
      ) : (
        <>
          <View accessibilityRole="list" accessibilityLabel={textIn(section.title, lang)}>
            {p.items.map((item, i) => {
              const key = itemKey(item);
              const rowIndex = item.kind === 'row' ? rowItems.indexOf(item) : -1;
              const selected = p.selectedKey === key;
              return (
                <View key={key}>
                  <EditorRow item={item} first={i === 0} selected={selected} focusable={p.focusKey === key} review={item.kind === 'row' && p.review.has(item.row.id)} narrow={p.narrow} weekEditable={p.weekEditable}
                    canUp={rowIndex > 0} canDown={rowIndex >= 0 && rowIndex < rowItems.length - 1} draggable={item.kind === 'row'} dropActive={p.drag.active} dropOver={p.drag.over === key}
                    setRef={node => { if (node) p.rowRefs.current.set(key, node); else p.rowRefs.current.delete(key); }}
                    onPress={() => p.onSelect(key)} onKey={keyPress => p.onRowKey(item, keyPress)} onAction={action => p.onAction(item, action)}
                    onDragStart={() => item.kind === 'row' && p.drag.start(item.row.id)} onDragEnd={p.drag.end} onDragOver={() => p.drag.hover(key)}
                    onDrop={() => item.kind === 'row' && p.drag.drop(section.id, section.rows.indexOf(item.row))} />
                  {selected && !p.narrow ? <View style={{ backgroundColor: k.stone, padding: 16, borderRadius: 10, marginTop: 4, marginBottom: 8, zIndex: 2 }}>{p.renderBuilder(item)}</View> : null}
                </View>
              );
            })}
            {p.items.length === 0 ? <Txt color={k.muted} style={{ paddingVertical: 10 }}>{t('editor.sectionEmpty')}</Txt> : null}
          </View>
          <DropTarget active={p.drag.active} onOver={() => p.drag.hover(`end:${section.id}`)} onDrop={() => p.drag.drop(section.id, section.rows.length)}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, borderTopWidth: p.drag.over === `end:${section.id}` ? 3 : 0, borderTopColor: k.tekhelet }}>
              {add('plus', t('editor.addRow'), 'row')}
              {add('plus', t('editor.addText'), 'text')}
              {add('plus', t('editor.addWeek'), 'week', true)}
            </View>
          </DropTarget>
        </>
      )}
    </Card>
  );
}
