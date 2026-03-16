import {
  createClient as _createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";

/**
 * Isomorphic Supabase client factory — no Tauri imports.
 * Each app (desktop, web, mobile) calls this with its own env vars and
 * platform-specific auth options (localStorage, cookies, AsyncStorage…).
 */
export function createSupabaseClient(
  url: string,
  anonKey: string,
  options?: SupabaseClientOptions<"public">
): SupabaseClient {
  return _createClient(url, anonKey, options);
}
