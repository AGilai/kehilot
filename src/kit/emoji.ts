/** Positions are UTF-16 offsets, as `TextInput.onSelectionChange` reports them. */
export type Selection = { start: number; end: number };

export function insertAt(text: string, selection: Selection, insert: string): { text: string; cursor: number } {
  const start = Math.min(Math.max(selection.start, 0), text.length);
  const end = Math.min(Math.max(selection.end, start), text.length);
  return { text: text.slice(0, start) + insert + text.slice(end), cursor: start + insert.length };
}

/** Length in code points, the way the server counts (`[...s].length`). */
export const codePoints = (s: string): number => [...s].length;

export const EMOJI: { category: string; items: string[] }[] = [
  { category: 'smileys', items: ['😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😍', '🥰', '😘', '😂', '🤗', '😇', '🥳', '😎', '🤔', '😢', '😭', '🙏', '😌'] },
  { category: 'hearts', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🤎', '💖', '💗', '💓', '💞', '💕', '💝', '❣️', '💔', '🫶', '😻', '💐', '🌹'] },
  { category: 'celebration', items: ['🎉', '🎊', '🎈', '🎁', '🥂', '🍷', '🍾', '🎂', '🍰', '🧁', '🍯', '🍎', '🥖', '🍇', '🎶', '🎵', '✨', '🌟', '⭐', '🏆'] },
  { category: 'hands', items: ['👍', '👏', '🙌', '🤝', '👋', '💪', '🙋', '🫂', '✌️', '🤞', '👌', '🤲', '☝️', '👐', '🖐️', '🫱', '🫲', '✋', '🤟', '🫡'] },
  { category: 'nature', items: ['🌸', '🌷', '🌻', '🌼', '🌺', '🌿', '🍀', '🌳', '🌴', '🍃', '🍂', '🌈', '☀️', '🌙', '⛅', '🌊', '🕊️', '🦋', '🐑', '🌱'] },
  { category: 'symbols', items: ['🕯️', '✡️', '🕎', '📜', '📖', '🕍', '🔯', '🏠', '👶', '👰', '🤵', '💍', '🎓', '🙇', '🖤', '⚱️', '🪔', '🔔', '✅', '➕'] },
];
