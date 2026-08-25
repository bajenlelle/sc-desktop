import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

// scoutable://auth/callback — must be in the Supabase Auth redirect allowlist.
// Only works in dev builds; Expo Go yields an exp:// URI that isn't allow-listed.
const redirectTo = makeRedirectUri({ scheme: "scoutable", path: "auth/callback" });

/**
 * Browser-based PKCE OAuth round-trip through Supabase's existing Google/Apple
 * providers (same ones the web app uses — no native client apps needed).
 * Returns true when a session was established, false when the user cancelled.
 */
export async function signInWithProvider(provider: "google" | "apple"): Promise<boolean> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Failed to start sign-in");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return false;

  const { params, errorCode } = QueryParams.getQueryParams(result.url);
  if (errorCode) throw new Error(errorCode);
  if (!params.code) throw new Error("No authorization code returned");

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
  if (exchangeError) throw new Error(exchangeError.message);
  return true;
}
