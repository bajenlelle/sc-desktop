import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
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
 *
 * iOS Apple sign-in does NOT come through here — see signInWithAppleNative.
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

/** iOS only — Apple's button is unavailable on Android and older iOS. */
export function isNativeAppleAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return Promise.resolve(false);
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/**
 * Native Sign in with Apple: the system sheet hands back a signed identity
 * token that Supabase verifies directly, so iOS never touches the browser
 * round-trip above — no ASWebAuthenticationSession, no redirect allowlist, and
 * no Services-ID client secret in the path. That fragile chain is what failed
 * App Review 2.1(a) for build 3, and it's also what Apple expects to see.
 *
 * Requires the app's bundle id (se.scoutable.app) in the Supabase Apple
 * provider's Client IDs list — the token audience is checked against it.
 *
 * Returns false when the user cancels the sheet.
 */
export async function signInWithAppleNative(): Promise<boolean> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    // Dismissing the sheet is a normal outcome, not a failure to report.
    if ((e as { code?: string })?.code === "ERR_REQUEST_CANCELED") return false;
    throw e;
  }

  if (!credential.identityToken) throw new Error("Apple didn't return an identity token");

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
  });
  if (error) throw new Error(error.message);
  return true;
}
