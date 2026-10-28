// The hall as a grid (UX-DESIGN §16.4, §16.8 HallGrid): drawn left to right as the room, in every language (never mirrored), ark and bimah as
// merged areas, block names over the blocks, row labels on both sides. One tab stop (role=grid, aria-activedescendant) and the keys are handled
// by the parent. Sizes are the former ones x1.1 (owner request). Pointer: a press selects, dragging draws a rectangle (hit test = the pure cellAt). Names only at 100% and above; at "fit" shapes.
import React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../../kit/components.tsx';
import { kindAt } from '../../../seats/editModel.ts';
import type { Draft, Kind } from '../../../seats/editModel.ts';
import { cellAt, parsePos, posKey } from '../../../seats/grid.ts';
import { fitFontSize } from '../../../seats/ownerLabel.ts';
import type { Pos } from '../../../seats/grid.ts';
import { keyOf } from '../scheduleEditor/controls.tsx';
import type { Key } from '../scheduleEditor/controls.tsx';

export type Mods = { shift: boolean; ctrl: boolean };
export type GridMode = 'assign' | 'layout' | 'readonly';
export const ZOOMS = { fit: { w: 33, h: 26 }, z100: { w: 68, h: 42 }, z150: { w: 102, h: 63 } } as const;
export type Zoom = keyof typeof ZOOMS;
const LABEL_W = 40;

export function HallGrid({ draft, mode, zoom, sel, focus, changed, selectedRef, struck, short, full, blockOnTop, onDown, onDrag, onUp, onKey }: {
  draft: Draft; mode: GridMode; zoom: Zoom; sel: string[]; focus: Pos | null; changed: Set<Pos>; selectedRef: string | null; struck: Set<Pos>;
  short: (ref: string) => string; full: (ref: string) => string;
  /** The selected household's blocks are drawn in tekhelet. */ blockOnTop: Set<string>;
  onDown: (pos: Pos, m: Mods) => void; onDrag: (pos: Pos) => void; onUp: (pos: Pos, dragged: boolean, m: Mods) => void; onKey: (k: Key) => void;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const L = draft.layout;
  const { w: cw, h: ch } = ZOOMS[zoom];
  const names = zoom !== 'fit';
  const selSet = React.useMemo(() => new Set(sel), [sel]);
  const bodyRef = React.useRef<View>(null);
  const live = React.useRef({ onDown, onDrag, onUp, cw, ch, rows: L.rows, cols: L.cols, mode });
  live.current = { onDown, onDrag, onUp, cw, ch, rows: L.rows, cols: L.cols, mode };

  // pointer events on the DOM node (web): one handler for the whole body, cells are found by arithmetic
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = bodyRef.current as unknown as HTMLElement | null;
    if (!node || !node.addEventListener) return;
    let down: Pos | null = null, last: Pos | null = null, dragged = false;
    const at = (e: PointerEvent): Pos | null => {
      const box = node.getBoundingClientRect();
      const c = cellAt(e.clientX - box.left, e.clientY - box.top, live.current.cw, live.current.ch, live.current.rows, live.current.cols, false);
      return c ? posKey(c.r, c.c) : null;
    };
    const mods = (e: PointerEvent): Mods => ({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    const move = (e: PointerEvent) => { const p = at(e); if (p && down && p !== last) { last = p; if (p !== down) dragged = true; live.current.onDrag(p); } };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      // a click acts where it went down (the page may scroll under the pointer between down and up)
      if (down) live.current.onUp(dragged ? at(e) ?? last ?? down : down, dragged, mods(e));
      down = null; last = null; dragged = false;
    };
    const start = (e: PointerEvent) => {
      if (e.button !== 0 || live.current.mode === 'readonly') return;
      const p = at(e);
      if (!p) return;
      node.focus?.();
      down = p; last = p; dragged = false;
      live.current.onDown(p, mods(e));
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      e.preventDefault();
    };
    node.addEventListener('pointerdown', start);
    return () => { node.removeEventListener('pointerdown', start); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const blockOf = (c: number) => L.blocks.find((b) => c >= b.colStart && c <= b.colEnd)?.name ?? '';
  const rowLabel = (r: number) => L.rowLabels[r] ?? '';
  const cellName = (r: number, c: number, kind: Kind): string => {
    const p = posKey(r, c);
    const where = [blockOf(c), rowLabel(r) ? t('seatMap.grid.row', { row: rowLabel(r) }) : ''].filter(Boolean).join(', ');
    let what: string;
    if (kind === 'seat') what = draft.assign[p] ? full(draft.assign[p]!) : t('seatMap.grid.free');
    else what = t(`seatMap.grid.${kind}`);
    return [where, what, changed.has(p) ? t('seatMap.grid.changed') : ''].filter(Boolean).join(', ');
  };
  const same = (r: number, c: number, kind: Kind) => kindAt(draft, posKey(r, c)) === kind;

  const cell = (r: number, c: number) => {
    const kind = L.cells[r]![c]!;
    const p = posKey(r, c);
    const ref = kind === 'seat' ? draft.assign[p] : undefined;
    const isSel = selSet.has(p);
    const mine = !!ref && ref === selectedRef;
    const merged = kind === 'bimah' || kind === 'ark';
    const edge = (rr: number, cc: number) => merged && same(rr, cc, kind);
    const showLabel = merged && !edge(r - 1, c) && !edge(r, c - 1);
    const isStruck = struck.has(p);
    let bg = 'transparent', bc = 'transparent', bw = 1, bs: 'solid' | 'dashed' = 'solid', fg = k.ink, text = '';
    if (kind === 'seat') {
      if (mode === 'layout') { bg = k.surface; bc = k.muted; }
      else if (ref) { bg = mine ? k.tekhelet : k.surface; bc = mine ? k.tekhelet : k.muted; fg = mine ? k.onAction : k.ink; text = `${mine ? '✓ ' : ''}${short(ref)}`; }
      else { bg = k.stone; bc = k.muted; bs = 'dashed'; bw = 1.5; text = t('seatMap.grid.free'); fg = k.muted; }
    } else if (kind === 'bimah') { bg = k.line; bc = k.muted; text = t('seatMap.grid.bimah'); }
    else if (kind === 'ark') { bg = k.surface; bc = k.tekhelet; bw = 2; text = t('seatMap.grid.ark'); }
    else if (kind === 'aisle' && mode === 'layout') { bg = k.stone; bc = k.line; bs = 'dashed'; }
    else if (kind === 'empty' && mode === 'layout') { bc = k.line; }
    if (isStruck) { bs = 'dashed'; bc = k.tekhelet; bg = 'transparent'; fg = k.muted; }
    const pad = merged ? 0 : 2;
    let runW = 1, runH = 1;
    if (showLabel) { while (same(r, c + runW, kind)) runW++; while (same(r + runH, c, kind)) runH++; }
    return (
      <View key={c} {...({ role: 'gridcell', id: `hg-${r}-${c}`, 'aria-label': cellName(r, c, kind), 'aria-selected': isSel } as object)} style={{ width: cw, height: ch, padding: pad, zIndex: showLabel ? 5 : 0 }}>
        <View style={{
          flex: 1, alignItems: 'center', justifyContent: 'center', overflow: showLabel ? 'visible' : 'hidden', backgroundColor: bg, borderStyle: bs, borderColor: bc, borderRadius: merged ? 0 : cw > 40 ? 7 : 4,
          borderTopWidth: edge(r - 1, c) ? 0 : bw, borderBottomWidth: edge(r + 1, c) ? 0 : bw, borderStartWidth: edge(r, c - 1) ? 0 : bw, borderEndWidth: edge(r, c + 1) ? 0 : bw,
          ...(kind === 'aisle' && mode === 'layout' ? ({ backgroundImage: `repeating-linear-gradient(90deg, ${k.line} 0 1px, transparent 1px 6px)` } as object) : {}),
          ...(kind === 'bimah' ? ({ backgroundImage: `repeating-linear-gradient(135deg, ${k.line} 0 2px, ${k.stone} 2px 7px)` } as object) : {}),
        }}>
          {kind === 'seat' && names && cw >= 60 ? <Txt size="caption" bold={mine} color={fg} numberOfLines={1} content style={{ textDecorationLine: isStruck ? 'line-through' : 'none', paddingHorizontal: 2, textAlign: 'center', fontSize: fitFontSize(text, cw - 2 * pad - 8), lineHeight: 16 }}>{text}</Txt> : null}
          {kind === 'seat' && (!names || cw < 60) && mine ? <Txt size="caption" bold color={fg}>{'✓'}</Txt> : null}
          {showLabel && (names || runW * cw >= 70) ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: runW * cw, height: runH * ch, alignItems: 'center', justifyContent: 'center' }}><Txt serif size="small" color={kind === 'ark' ? k.tekhelet : k.ink}>{text}</Txt></View> : null}
          {isSel ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderStyle: 'dashed', borderColor: k.tekhelet, borderRadius: merged ? 0 : 6, backgroundColor: 'rgba(42,63,148,0.12)' }} /> : null}
          {changed.has(p) ? <View pointerEvents="none" style={{ position: 'absolute', top: 1, left: 1, width: 7, height: 7, borderRadius: 4, backgroundColor: k.gold }} /> : null}
          {focus === p ? <View pointerEvents="none" style={{ position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderWidth: 2, borderColor: k.tekhelet, borderRadius: merged ? 0 : 7 }} /> : null}
        </View>
      </View>
    );
  };

  const labels = (side: 'l' | 'r') => (
    <View style={{ width: LABEL_W }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: L.rows }, (_, r) => <View key={r} style={{ height: ch, justifyContent: 'center', alignItems: side === 'l' ? 'flex-end' : 'flex-start', paddingHorizontal: 6 }}><Txt size="caption" color={k.muted} content>{rowLabel(r)}</Txt></View>)}
    </View>
  );
  const active = focus ? `hg-${parsePos(focus).r}-${parsePos(focus).c}` : undefined;
  return (
    <ScrollView horizontal contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ direction: 'ltr' }}>
        <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ width: LABEL_W }} />
          <View style={{ width: L.cols * cw, height: 28 }}>
            {L.blocks.map((b, i) => (
              <View key={i} style={{ position: 'absolute', left: b.colStart * cw, width: (b.colEnd - b.colStart + 1) * cw, height: 24, paddingHorizontal: 3 }}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: blockOnTop.has(b.name) ? k.tekhelet : k.line }}>
                  <Txt size="caption" bold={blockOnTop.has(b.name)} color={blockOnTop.has(b.name) ? k.tekhelet : k.muted} numberOfLines={1} content>{b.name}</Txt>
                </View>
              </View>
            ))}
          </View>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {labels('l')}
          <View ref={bodyRef} focusable={mode !== 'readonly'}
            {...({ role: 'grid', tabIndex: 0, 'aria-label': t('seatMap.grid.label'), 'aria-rowcount': L.rows, 'aria-colcount': L.cols, 'aria-activedescendant': active, onKeyDown: (e: unknown) => onKey(keyOf(e)) } as object)}
            style={{ width: L.cols * cw, cursor: mode === 'readonly' ? 'auto' : 'pointer', ...({ userSelect: 'none', outlineStyle: 'none' } as object) }}>
            {Array.from({ length: L.rows }, (_, r) => (
              <View key={r} {...({ role: 'row', 'aria-rowindex': r + 1 } as object)} style={{ flexDirection: 'row', height: ch }}>
                {Array.from({ length: L.cols }, (_, c) => cell(r, c))}
              </View>
            ))}
          </View>
          {labels('r')}
        </View>
      </View>
    </ScrollView>
  );
}
