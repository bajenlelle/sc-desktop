/**
 * Single home for updater checks. The banner (UpdateChecker), the settings
 * button, and the app menu's "Check for Updates…" all funnel through here —
 * previously the check() logic was duplicated per call site.
 *
 * Also where an update's analytics are sent from: what was offered, what the
 * coach did with it and how the install went (types/analytics.ts, "App updates").
 */
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import {
  parsePendingUpdate,
  resolvePendingUpdate,
  shortError,
  type PendingUpdate,
} from "@scoutable/shared/lib/update-outcome";
import { trackEvent, type AnalyticsEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";

/** Fired when any interactive check finds an update; UpdateChecker shows the sidebar card. */
export const UPDATE_FOUND_EVENT = "update-found";

/** What looked for the release: the app starting, its periodic look, or the coach asking. */
export type UpdateCheckVia = "startup" | "recheck" | "manual";

type UpdateEvent = Extract<AnalyticsEvent, `update_${string}`>;

let runningVersion: Promise<string> | null = null;

/** The version of the app that is running, asked for once. */
function appVersion(): Promise<string> {
  runningVersion ??= getVersion().catch(() => "unknown");
  return runningVersion;
}

/**
 * Sends an update event with the running version on it as from_version.
 * `instantly` for one the install may cut off (see trackEvent).
 */
export function trackUpdate(
  event: UpdateEvent,
  properties: Record<string, unknown> = {},
  options?: { instantly?: boolean },
) {
  void appVersion().then((from_version) => trackEvent(event, { from_version, ...properties }, options));
}

/**
 * The note an install leaves for the next start (lib/update-outcome.ts): on
 * Windows the install ends the process, so nothing after it can report.
 */
const PENDING_UPDATE_KEY = "scoutable_pending_update";

/** Call right before the install: from here on only the next start knows how it went. */
export async function markUpdatePending(to: string): Promise<void> {
  const pending: PendingUpdate = { from: await appVersion(), to, at: Date.now() };
  try {
    localStorage.setItem(PENDING_UPDATE_KEY, JSON.stringify(pending));
  } catch {
    // No storage: the install goes ahead, its outcome just isn't reported.
  }
}

/** The install failed while the app was still running, and said so itself. */
export function clearPendingUpdate() {
  try {
    localStorage.removeItem(PENDING_UPDATE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * On app start: reports the install the last run began, if any. Running the
 * new version, it worked; still on the old one, the installer failed after
 * the app had quit, which nothing else would tell us.
 */
export function reportPendingUpdate(currentVersion: string) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PENDING_UPDATE_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  clearPendingUpdate();
  const outcome = resolvePendingUpdate(parsePendingUpdate(raw), currentVersion, Date.now());
  if (!outcome) return;
  if (outcome.kind === "installed") {
    trackEvent("update_installed", {
      from_version: outcome.fromVersion,
      version: outcome.version,
      seconds: outcome.seconds,
    });
  } else {
    trackEvent("update_install_failed", {
      from_version: outcome.fromVersion,
      version: outcome.version,
      stage: "after_restart",
      seconds: outcome.seconds,
    });
  }
}

/**
 * Silent check (app start, and the periodic look): no toasts, breadcrumb on
 * failure (offline checks are routine). Returns the update when one is
 * available, else null.
 */
export async function silentUpdateCheck(via: Exclude<UpdateCheckVia, "manual"> = "startup"): Promise<Update | null> {
  try {
    const update = await check();
    return update?.available ? update : null;
  } catch (e) {
    Sentry.addBreadcrumb({
      category: "updater",
      message: `update check failed: ${e instanceof Error ? e.message : String(e)}`,
      level: "warning",
    });
    trackUpdate("update_check_failed", { via, error: shortError(e) });
    return null;
  }
}

/**
 * User-initiated check (settings button, menu item): toasts the outcome and
 * hands any found update to the banner via UPDATE_FOUND_EVENT so the install
 * affordance is the same everywhere.
 */
export async function interactiveUpdateCheck(): Promise<void> {
  try {
    const update = await check();
    if (update?.available) {
      window.dispatchEvent(new CustomEvent<Update>(UPDATE_FOUND_EVENT, { detail: update }));
      toast.info(`Version ${update.version} is available. Install it from the card in the sidebar.`);
    } else {
      toast.success("You're on the latest version.");
    }
  } catch (e) {
    trackUpdate("update_check_failed", { via: "manual", error: shortError(e) });
    toast.error("Couldn't reach the update server. Are you online?");
  }
}
