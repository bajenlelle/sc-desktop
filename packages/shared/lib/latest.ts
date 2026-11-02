/**
 * "Only the latest counts" helpers: a newer run for the same key stops the
 * older one at once, and of two requests the one made last wins.
 */

/** One run per key: starting a new run aborts the one before it, before anything else happens. */
export function createLatestRuns() {
  const running = new Map<string, AbortController>();
  return {
    start(key: string): AbortSignal {
      running.get(key)?.abort();
      const controller = new AbortController();
      running.set(key, controller);
      return controller.signal;
    },
    /** Forgets the run, unless a newer one has taken its place. */
    finish(key: string, signal: AbortSignal): void {
      if (running.get(key)?.signal === signal) running.delete(key);
    },
    isRunning(key: string): boolean {
      return running.has(key);
    },
  };
}

/** Of two requests stamped with a nonce (Date.now()), the one made last. */
export function newestRequest<T extends { nonce: number }>(a: T | null | undefined, b: T | null | undefined): T | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.nonce >= a.nonce ? b : a;
}
