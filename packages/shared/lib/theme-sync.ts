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
 */

export type ThemeModeSetting = "light" | "dark" | "system";

export interface ThemePrefs {
  themeDark: string | null;
  themeLight: string | null;
  themeMode: ThemeModeSetting | null;
}

const MODES: ReadonlyArray<string> = ["light", "dark", "system"];

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
