/**
 * Pure result types + helpers for the desktop's clip-and-ship pipeline
 * (render + upload lives in apps/desktop — Tauri/S3 deps stay out of
 * shared). Extracted here so the failure grouping and retry-merge logic the
 * share dialog depends on is unit-testable.
 */

export interface ClipShipFailure {
  matchId: string;
  eventId: number;
  /** Human-readable cause (ffmpeg stderr, network error, …). */
  message: string;
}

export interface ClipShipResult {
  /** Clips uploaded during this run. */
  shipped: number;
  /** Clips that needed no work (already uploaded, or timing not computable). */
  skipped: number;
  /** Clips still failing after the automatic retry. */
  failures: ClipShipFailure[];
  /** Every successful upload of this run — callers patch local state with these. */
  uploaded: Array<{ matchId: string; eventId: number; r2Url: string }>;
  /** True when the run was cancelled between clips; remaining work untouched. */
  aborted: boolean;
}

/**
 * Collapse per-clip failures into display rows: identical messages dedupe
 * into one row with a count, sorted by count (desc), truncated to `max`.
 * Callers render a "+ N more" line for the remainder.
 */
export function groupShipFailures(
  failures: ClipShipFailure[],
  max = 3
): Array<{ message: string; count: number }> {
  const byMessage = new Map<string, number>();
  for (const f of failures) {
    byMessage.set(f.message, (byMessage.get(f.message) ?? 0) + 1);
  }
  return [...byMessage.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

/**
 * Fold a retry run into the original result ("Try again" in the share
 * dialog): uploads accumulate, and the retry's failure list REPLACES the
 * original one — the retry attempted exactly the previously-failed clips,
 * so whatever it reports is the complete remaining-failure set.
 */
export function mergeShipResults(first: ClipShipResult, retry: ClipShipResult): ClipShipResult {
  return {
    shipped: first.shipped + retry.shipped,
    skipped: first.skipped + retry.skipped,
    failures: retry.failures,
    uploaded: [...first.uploaded, ...retry.uploaded],
    aborted: retry.aborted,
  };
}
