/**
 * Marketing email consent (email_preferences, 20261001110000). Shared by the
 * web and desktop profile toggles. The consent time is set by the server, so
 * clients only say yes or no.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The caller's consent time, or null for no marketing email. */
export async function getMarketingConsent(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("email_preferences")
    .select("marketing_consent_at")
    .maybeSingle();
  if (error) throw new Error(`Failed to load email preferences: ${error.message}`);
  return (data?.marketing_consent_at as string | null | undefined) ?? null;
}

export async function setMarketingConsent(supabase: SupabaseClient, consent: boolean): Promise<string | null> {
  const { data, error } = await supabase.rpc("set_marketing_consent", { p_consent: consent });
  if (error) throw new Error(`Failed to save email preferences: ${error.message}`);
  return (data as string | null) ?? null;
}
