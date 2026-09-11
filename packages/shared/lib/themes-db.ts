/**
 * Server persistence for theme prefs. Writes ride the existing
 * profiles_update_own RLS policy (same pattern as celebrated_plan_tier) —
 * no RPC needed. This is plumbing: the pick already applied locally, so a
 * failed write degrades silently (reported, caller reverts its optimistic
 * ref and the next profile load self-heals).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";
import type { ThemePrefs } from "./theme-sync";

/** Returns true on success; false (after reporting) on any failure. */
export async function saveThemePrefs(
  supabase: SupabaseClient,
  prefs: Partial<ThemePrefs>,
): Promise<boolean> {
  const row: Record<string, string> = {};
  if (prefs.themeDark !== undefined && prefs.themeDark !== null) row.theme_dark = prefs.themeDark;
  if (prefs.themeLight !== undefined && prefs.themeLight !== null) {
    row.theme_light = prefs.themeLight;
  }
  if (prefs.themeMode !== undefined && prefs.themeMode !== null) row.theme_mode = prefs.themeMode;
  if (Object.keys(row).length === 0) return true;

  try {
    // getSession (local) over getUser (a network round trip): RLS already
    // scopes the update to the caller's own row, so the id is only a filter —
    // and an extra network hop here turns flaky wifi into a silently
    // unpersisted pick (write "fails", caller reverts its optimistic ref).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return false;
    const { error } = await supabase.from("profiles").update(row).eq("id", session.user.id);
    if (error) {
      reportDbError("saveThemePrefs", error);
      return false;
    }
    return true;
  } catch (e) {
    reportDbError("saveThemePrefs", { message: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
