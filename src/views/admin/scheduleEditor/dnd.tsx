// Drag to reorder (web only: the HTML5 drag-and-drop events). Drag is never the only way: every row also moves with Alt+arrows and its menu.
import React from 'react';
import { Platform, View } from 'react-native';
import { Icon } from '../../../kit/Icon.tsx';

type DragEvt = { preventDefault: () => void; dataTransfer?: { setData: (type: string, value: string) => void; effectAllowed: string; dropEffect: string } };

/** The grip: a draggable handle on web, a plain icon elsewhere. */
export function Grip({ label, color, draggable, onDragStart, onDragEnd }: { label: string; color: string; draggable: boolean; onDragStart?: () => void; onDragEnd?: () => void }) {
  const icon = <Icon name="grip" size={20} color={color} />;
  if (Platform.OS !== 'web' || !draggable) return <View style={{ width: 24, height: 44, alignItems: 'center', justifyContent: 'center', opacity: draggable ? 1 : 0.35 }}>{icon}</View>;
  return React.createElement('div', {
    draggable: true, title: label, 'aria-label': label, role: 'img',
    onDragStart: (e: DragEvt) => { e.dataTransfer?.setData('text/plain', 'row'); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); },
    onDragEnd: () => onDragEnd?.(),
    style: { width: 24, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab' },
  }, icon);
}

/** Wraps a row (or the end of a section) as a drop target; `active` says a row is being dragged. */
export function DropTarget({ active, onOver, onDrop, children }: { active: boolean; onOver: () => void; onDrop: () => void; children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return React.createElement('div', {
    onDragOver: (e: DragEvt) => { if (!active) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; onOver(); },
    onDrop: (e: DragEvt) => { if (!active) return; e.preventDefault(); onDrop(); },
    style: { display: 'contents' },
  }, children);
}
