/**
 * Pure reconcile logic for cross-device theme sync (Slack-style).
 *
 * The protocol, implemented by each app's ThemeSync watcher:
 * - `lastServerRef` holds the RAW server values last observed (adopted) or
 *   optimistically written — raw so an unknown theme id from a newer client
 *   is never clobbered back by an older one.
 * - Adoption (profile snapshot or realtime UPDATE): set the ref FIRST, then
 *   apply `planAdoption(server, local)` locally. Adoption NEVER writes —
 *   that is what makes echo loops structurally impossible.
 * - Local watcher: `planWrite(local, ref)` — empty until a first server
 *   snapshot exists, so nothing is pushed at boot (and since the watcher
 *   only runs on local CHANGES, an all-null snapshot alone never triggers a
 *   write either — a user action does). Once it fires, the diff includes the
 *   device's current values for any still-null server fields: the first pick
 *   anywhere materializes the full appearance state, by design. Empty when
 *   the change was an adoption echo (ref was pre-set). Non-empty diffs are
 *   merged into the ref optimistically and written fire-and-forget; a failed
 *   write reverts the ref fields so the next snapshot self-heals and a
 *   re-pick retries.
 * - NULL server fields mean "never synced" and are never applied.
 * - Unknown-id guard: when adoption cannot apply a slot (a theme id from a
 *   newer client), the field is marked "unapplied" and excluded from writes
 *   until the user actually picks that slot on this device — otherwise any
 *   later write would clobber the newer client's pick with this device's
 *   fallback (see unappliedSlotsFor/filterUnappliedSlots).
 *
 * Invariant the watchers rely on: auth contexts deliver `profile` only
 * asynchronously after `user` (all three do today). If a context ever seeded
 * profile synchronously at mount, T1's adoption and T3 would run in the same
 * commit with pre-adoption local values and push them to the server.
 */

import { getTheme } from "./themes";

export type ThemeModeSetting = "light" | "dark" | "system";

export interface ThemePrefs {
  themeDark: string | null;
  themeLight: string | null;
  themeMode: ThemeModeSetting | null;
}

const MODES: ReadonlyArray<string> = ["light", "dark", "system"];

/**
 * How long a failed Realtime join may keep failing before it's worth a
 * Sentry event. Realtime's cold join routinely reports CHANNEL_ERROR or
 * TIMED_OUT once before supabase-js's own rejoin succeeds (in production the
 * first theme change lands late and every later one is instant), and a
 * suspended device closes its socket with 1006 as a matter of course.
 * Reporting the first failure filed six duplicate issues in the hour after
 * theme sync shipped; only a failure still unresolved after this window says
 * anything actionable.
 */
export const REALTIME_REPORT_GRACE_MS = 30_000;

/**
 * Whether a `subscribe` status means the join failed, as opposed to ordinary
 * lifecycle churn (SUBSCRIBED / CLOSED) the watchers ignore.
 */
export function isTransientRealtimeFailure(status: string): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT";
}

/** Snake_case profiles row / realtime payload.new -> ThemePrefs. Invalid or missing values become null. */
export function prefsFromRow(row: Record<string, unknown>): ThemePrefs {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const mode = str(row["theme_mode"]);
  return {
    themeDark: str(row["theme_dark"]),
    themeLight: str(row["theme_light"]),
    themeMode: mode && MODES.includes(mode) ? (mode as ThemeModeSetting) : null,
  };
}

/**
 * Fields to apply locally from a server snapshot: non-null AND different
 * from the current local value. Null server fields are skipped (never
 * synced -> device default stays).
 */
export function planAdoption(server: ThemePrefs, local: ThemePrefs): Partial<ThemePrefs> {
  const out: Partial<ThemePrefs> = {};
  if (server.themeDark !== null && server.themeDark !== local.themeDark) {
    out.themeDark = server.themeDark;
  }
  if (server.themeLight !== null && server.themeLight !== local.themeLight) {
    out.themeLight = server.themeLight;
  }
  if (server.themeMode !== null && server.themeMode !== local.themeMode) {
    out.themeMode = server.themeMode;
  }
  return out;
}

/**
 * Fields to write to the server after a local change: only once a first
 * server snapshot exists (`ref` non-null — the gate that keeps platform
 * defaults from ever being pushed), and only fields whose local value is
 * concrete and differs from the ref. An adoption echo diffs to {} because
 * the ref was set before the local apply.
 */
export function planWrite(local: ThemePrefs, ref: ThemePrefs | null): Partial<ThemePrefs> {
  if (ref === null) return {};
  const out: Partial<ThemePrefs> = {};
  if (local.themeDark !== null && local.themeDark !== ref.themeDark) {
    out.themeDark = local.themeDark;
  }
  if (local.themeLight !== null && local.themeLight !== ref.themeLight) {
    out.themeLight = local.themeLight;
  }
  if (local.themeMode !== null && local.themeMode !== ref.themeMode) {
    out.themeMode = local.themeMode;
  }
  return out;
}

/** Which slot fields of a server snapshot this client cannot render (theme id unknown to its registry, or filed under the wrong mode). */
export interface UnappliedSlots {
  themeDark: boolean;
  themeLight: boolean;
}

export function unappliedSlotsFor(server: ThemePrefs): UnappliedSlots {
  return {
    themeDark: server.themeDark !== null && getTheme(server.themeDark)?.mode !== "dark",
    themeLight: server.themeLight !== null && getTheme(server.themeLight)?.mode !== "light",
  };
}

/**
 * Strip unapplied slot fields from a pending write: those fields still hold
 * this device's fallback, not a user choice, and writing them would clobber
 * a newer client's pick. A field is reclaimed (written, unmasked) only when
 * its local value changed since the previous evaluation — i.e. the user
 * actually picked that slot on this device. Returns the filtered diff and
 * the updated mask.
 */
export function filterUnappliedSlots(
  diff: Partial<ThemePrefs>,
  unapplied: UnappliedSlots,
  prevLocal: ThemePrefs | null,
  local: ThemePrefs,
): { diff: Partial<ThemePrefs>; unapplied: UnappliedSlots } {
  const outDiff = { ...diff };
  const outMask = { ...unapplied };
  for (const field of ["themeDark", "themeLight"] as const) {
    if (outDiff[field] === undefined || !outMask[field]) continue;
    if (prevLocal !== null && prevLocal[field] !== local[field]) {
      outMask[field] = false;
    } else {
      delete outDiff[field];
    }
  }
  return { diff: outDiff, unapplied: outMask };
}
