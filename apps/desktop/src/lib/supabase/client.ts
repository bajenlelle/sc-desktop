import { createSupabaseClient } from "@scoutable/shared/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (!client) {
    client = createSupabaseClient(
      import.meta.env.VITE_SUPABASE_URL!,
      import.meta.env.VITE_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: window.localStorage,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: "implicit",
        },
      }
    );
  }
  return client;
}

export async function signInWithProvider(provider: "google" | "apple") {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: "scoutable://auth/callback",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) throw error ?? new Error("No OAuth URL returned");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(data.url);
}
