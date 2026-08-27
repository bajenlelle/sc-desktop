/**
 * Error-reporting hook for the shared DB helpers.
 *
 * Several `*-db.ts` functions degrade gracefully on failure (log + return an
 * empty result) so one broken query doesn't take down a whole page. That
 * grace made failures invisible: a user's "my playlists disappeared" left no
 * trace anywhere. Every such site now funnels through `reportDbError`, and
 * each app plugs its crash reporter in via `setDbErrorReporter` at startup —
 * this package stays dependency-free.
 */

export interface DbError {
  message: string;
  code?: string;
  details?: string;
}

type DbErrorReporter = (fnName: string, error: DbError) => void;

let reporter: DbErrorReporter | undefined;

/** Called once at app startup (e.g. to forward into Sentry). */
export function setDbErrorReporter(fn: DbErrorReporter) {
  reporter = fn;
}

export function reportDbError(fnName: string, error: DbError): void {
  console.error(`${fnName}:`, error.message);
  try {
    reporter?.(fnName, error);
  } catch {
    // Reporting must never break the caller's graceful degradation.
  }
}
