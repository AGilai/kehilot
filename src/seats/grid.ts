/**
 * The selection model of the hall grid (pure, UX-DESIGN §16.4/§16.9): positions are "row:col" keys, a rectangle is
 * taken between two cells whichever way it was dragged, and pixels map to cells with an optional mirror (a grid drawn
 * right to left counts columns from the right edge). The hall itself is drawn left to right, as the room, in every
 * language, so the editor passes `mirrored: false`; the mirror stays here so the geometry is tested both ways.
 */
export type Pos = string;
export const posKey = (r: number, c: number): Pos => `${r}:${c}`;
export function parsePos(p: Pos): { r: number; c: number } {
  const [r, c] = p.split(':').map(Number);
  return { r: r!, c: c! };
}
export type Dir = 'left' | 'right' | 'up' | 'down';

/** Pixel to cell inside a grid of `cols` x `rows` cells; null outside. `mirrored`: column 0 sits at the right edge. */
export function cellAt(x: number, y: number, cellW: number, cellH: number, rows: number, cols: number, mirrored = false): { r: number; c: number } | null {
  if (x < 0 || y < 0 || cellW <= 0 || cellH <= 0) return null;
  const r = Math.floor(y / cellH);
  const raw = Math.floor(x / cellW);
  if (r >= rows || raw >= cols) return null;
  return { r, c: mirrored ? cols - 1 - raw : raw };
}

/** All positions in the rectangle spanned by two cells (either corner order), filtered by `pred`. Row-major, left to right. */
export function rectKeys(a: Pos, b: Pos, pred: (p: Pos) => boolean = () => true): Pos[] {
  const A = parsePos(a), B = parsePos(b);
  const out: Pos[] = [];
  for (let r = Math.min(A.r, B.r); r <= Math.max(A.r, B.r); r++) {
    for (let c = Math.min(A.c, B.c); c <= Math.max(A.c, B.c); c++) { const k = posKey(r, c); if (pred(k)) out.push(k); }
  }
  return out;
}

/** One step by the arrow keys, clamped to the grid. `mirrored` swaps left and right. */
export function stepPos(p: Pos, dir: Dir, rows: number, cols: number, mirrored = false): Pos {
  const { r, c } = parsePos(p);
  const d = mirrored ? (dir === 'left' ? 'right' : dir === 'right' ? 'left' : dir) : dir;
  const nr = d === 'up' ? r - 1 : d === 'down' ? r + 1 : r;
  const nc = d === 'left' ? c - 1 : d === 'right' ? c + 1 : c;
  return posKey(Math.max(0, Math.min(rows - 1, nr)), Math.max(0, Math.min(cols - 1, nc)));
}
/** Home / End: first / last column of the row. PageUp / PageDown: front / back row of the column. */
export function jumpPos(p: Pos, to: 'home' | 'end' | 'front' | 'back', rows: number, cols: number): Pos {
  const { r, c } = parsePos(p);
  return to === 'home' ? posKey(r, 0) : to === 'end' ? posKey(r, cols - 1) : to === 'front' ? posKey(0, c) : posKey(rows - 1, c);
}

export type Sel = { anchor: Pos | null; focus: Pos | null; keys: Pos[]; /** Kept from before an additive drag. */ base: Pos[] };
export const emptySel = (): Sel => ({ anchor: null, focus: null, keys: [], base: [] });
const sorted = (keys: Iterable<Pos>): Pos[] => [...new Set(keys)].sort((x, y) => { const a = parsePos(x), b = parsePos(y); return a.r - b.r || a.c - b.c; });

export type SelAction =
  | { type: 'click'; pos: Pos; pred: (p: Pos) => boolean }
  /** Ctrl / Cmd click or Space: toggle one cell, keep the rest. */
  | { type: 'toggle'; pos: Pos; pred: (p: Pos) => boolean }
  /** Mouse down on a cell starts a rectangle (additive keeps the current selection). */
  | { type: 'start'; pos: Pos; additive?: boolean; pred: (p: Pos) => boolean }
  /** Drag over / Shift+click / Shift+arrows: the rectangle from the anchor to `pos`. */
  | { type: 'to'; pos: Pos; pred: (p: Pos) => boolean }
  | { type: 'move'; pos: Pos }
  /** A plain arrow: the focus and the anchor of the next Shift+arrow move, the selection stays. */
  | { type: 'anchor'; pos: Pos }
  | { type: 'clear' };

export function selReducer(s: Sel, a: SelAction): Sel {
  switch (a.type) {
    case 'clear': return emptySel();
    case 'anchor': return { ...s, anchor: a.pos, focus: a.pos, base: s.keys };
    case 'move': return { ...s, anchor: s.anchor ?? a.pos, focus: a.pos };
    case 'click': return { anchor: a.pos, focus: a.pos, keys: a.pred(a.pos) ? [a.pos] : [], base: [] };
    case 'toggle': {
      if (!a.pred(a.pos)) return { ...s, anchor: a.pos, focus: a.pos };
      const has = s.keys.includes(a.pos);
      const keys = has ? s.keys.filter((k) => k !== a.pos) : sorted([...s.keys, a.pos]);
      return { anchor: a.pos, focus: a.pos, keys, base: keys };
    }
    case 'start': {
      const base = a.additive ? s.keys : [];
      return { anchor: a.pos, focus: a.pos, keys: sorted([...base, ...rectKeys(a.pos, a.pos, a.pred)]), base };
    }
    case 'to': {
      const anchor = s.anchor ?? a.pos;
      return { anchor, focus: a.pos, keys: sorted([...s.base, ...rectKeys(anchor, a.pos, a.pred)]), base: s.base };
    }
  }
}
