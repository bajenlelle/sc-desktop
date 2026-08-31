/**
 * Single home for updater checks. The banner (UpdateChecker), the settings
 * button, and the app menu's "Check for Updates…" all funnel through here —
 * previously the check() logic was duplicated per call site.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { Sentry } from "@/lib/sentry";

/** Fired when any interactive check finds an update; UpdateChecker shows the banner. */
export const UPDATE_FOUND_EVENT = "update-found";

/**
 * Silent startup check: no toasts, breadcrumb on failure (offline checks are
 * routine). Returns the update when one is available, else null.
 */
export async function silentUpdateCheck(): Promise<Update | null> {
  try {
    const update = await check();
    return update?.available ? update : null;
  } catch (e) {
    Sentry.addBreadcrumb({
      category: "updater",
      message: `update check failed: ${e instanceof Error ? e.message : String(e)}`,
      level: "warning",
    });
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
      toast.info(`Version ${update.version} is available — use the banner at the top to install.`);
    } else {
      toast.success("You're on the latest version.");
    }
  } catch {
    toast.error("Couldn't reach the update server. Are you online?");
  }
}
