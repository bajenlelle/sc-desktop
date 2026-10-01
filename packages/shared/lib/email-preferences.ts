/**
 * Marketing email preferences (email_preferences, 20261001110000), shared by
 * the web and desktop profile toggles. For now marketing email (tips, offers,
 * free-import top-ups) goes to every account that hasn't unsubscribed, so the
 * toggle shows "on" until someone turns it off or unsubscribes. Turning it on
 * also records an explicit opt-in. The server sets every timestamp.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Whether the caller receives marketing email: on unless they unsubscribed. */
export async function getMarketingEmailsOn(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_preferences")
    .select("unsubscribed_at")
    .maybeSingle();
  if (error) throw new Error(`Failed to load email preferences: ${error.message}`);
  return !data?.unsubscribed_at;
}

export async function setMarketingEmailsOn(supabase: SupabaseClient, on: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_marketing_consent", { p_consent: on });
  if (error) throw new Error(`Failed to save email preferences: ${error.message}`);
}
