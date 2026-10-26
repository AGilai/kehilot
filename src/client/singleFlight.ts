/** Wraps an async action so a call made while one is running is ignored. The flag is a plain variable (synchronous), not React state. */
export function singleFlight(fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try { await fn(); } finally { running = false; }
  };
}
