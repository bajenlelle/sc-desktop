/**
 * Each playlist's writes in flight, by playlist id, for the whole app: a write
 * waits for the one before it on the same playlist, whichever page started
 * it. The game view's collecting (use-collect.ts) and a report's Add clips
 * (use-report-add-clips.ts) write through here, so a game a tab switch just
 * left may still be writing and the next page's writes wait for it.
 */
const chains = new Map<string, Promise<void>>();

/**
 * Runs `job` after the playlist's writes before it (and after `after`, a
 * page's own read). Never rejects: a job says its own failure.
 */
export function enqueuePlaylistWrite(playlistId: string, job: () => Promise<void>, after?: Promise<unknown>): Promise<void> {
  const before = chains.get(playlistId);
  const waits = [before, after].filter((p): p is Promise<unknown> => !!p);
  const next = (waits.length > 0 ? Promise.all(waits) : Promise.resolve()).then(job).catch(() => {});
  chains.set(playlistId, next);
  void next.then(() => {
    if (chains.get(playlistId) === next) chains.delete(playlistId);
  });
  return next;
}

/** The playlist's writes so far, settled (never rejects). */
export function playlistWritesSettled(playlistId: string): Promise<void> {
  return chains.get(playlistId) ?? Promise.resolve();
}

/** Every playlist's writes so far, settled: a page's read waits for them, never reading a base about to change. */
export function allPlaylistWritesSettled(): Promise<void> {
  return Promise.all([...chains.values()]).then(() => {});
}

/** Forgets every chain, for a user signing out. */
export function forgetPlaylistWrites(): void {
  chains.clear();
}
