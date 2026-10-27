/** Wraps an async action so a call made while one is running is ignored. The flag is a plain variable (synchronous), not React state. */
export function singleFlight(fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try { await fn(); } finally { running = false; }
  };
}

/** One guard per key: a call for a key that is running is ignored; other keys proceed. Hold it in a ref. */
export function keyedFlight(): (key: string, fn: () => Promise<void>) => Promise<void> {
  const running = new Set<string>();
  return async (key, fn) => {
    if (running.has(key)) return;
    running.add(key);
    try { await fn(); } finally { running.delete(key); }
  };
}
