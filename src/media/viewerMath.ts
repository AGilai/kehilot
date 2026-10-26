export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** A swipe down closes only at base zoom: far enough (dy > 120) or fast enough (vy > 800 px/s). */
export function shouldDismiss({ dy, vy, scale }: { dy: number; vy: number; scale: number }): boolean {
  return scale <= 1.01 && (dy > 120 || vy > 800);
}

export const doubleTapScale = (scale: number): number => (scale === 1 ? 2.5 : 1);

type Size = { width: number; height: number };

/**
 * Keeps the zoomed image's edge from leaving the screen's edge. `image` is the displayed size at scale 1
 * (contain-fitted); an axis where the zoomed image is not larger than the box cannot pan.
 */
export function clampPan(p: { x: number; y: number }, scale: number, box: Size, image: Size): { x: number; y: number } {
  const lim = (shown: number, avail: number) => Math.max(0, (shown * scale - avail) / 2);
  const mx = lim(image.width, box.width); const my = lim(image.height, box.height);
  const c = (v: number, m: number) => (m === 0 ? 0 : Math.min(m, Math.max(-m, v)));
  return { x: c(p.x, mx), y: c(p.y, my) };
}
