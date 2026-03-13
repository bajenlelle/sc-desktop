import { createClient as _createClient, type SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: SupabaseClient<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClient(): SupabaseClient<any> {
  if (!client) {
    client = _createClient(
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
