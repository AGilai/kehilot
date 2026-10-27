export type Prayer = 'arvit' | 'shacharit';
export const PRAYERS: Prayer[] = ['arvit', 'shacharit'];

/** A new set with `key` added or removed. */
export function toggleRelease(released: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(released);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

/** How many of his seats he needs and how many are free for others. */
export function releaseCounts(seatCount: number, released: ReadonlySet<string>): { need: number; free: number } {
  const free = Math.min(released.size, seatCount);
  return { need: seatCount - free, free };
}
