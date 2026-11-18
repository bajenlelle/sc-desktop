/**
 * One-shot "desktop_first_signin" analytics event: fires the first time an
 * account signs in on a desktop app, detected by the account having exactly
 * one desktop device row that was created in the last few minutes. The
 * localStorage key keeps it to a single query per account per machine.
 * Never throws; callers fire-and-forget.
 */
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";

const KEY_PREFIX = "sc-first-desktop-signin:";
const FRESH_WINDOW_MS = 10 * 60 * 1000;

export async function trackFirstDesktopSignin(userId: string): Promise<void> {
  try {
    const key = KEY_PREFIX + userId;
    if (window.localStorage.getItem(key)) return;

    const { data, error } = await createClient()
      .from("user_devices")
      .select("first_seen")
      .eq("user_id", userId)
      .eq("app", "desktop");
    if (error || !data) return;

    if (data.length === 1) {
      const firstSeen = Date.parse(data[0].first_seen as string);
      if (Number.isFinite(firstSeen) && Date.now() - firstSeen <= FRESH_WINDOW_MS) {
        trackEvent("desktop_first_signin", {});
      }
    }
    window.localStorage.setItem(key, "1");
  } catch {
    // Analytics must never affect sign-in.
  }
}
