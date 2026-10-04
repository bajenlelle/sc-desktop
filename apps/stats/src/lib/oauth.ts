import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

// scoutable-stats://auth/callback — add to the Supabase Auth redirect allowlist
// before the first TestFlight build (the reader app's scheme is scoutable://).
const redirectTo = makeRedirectUri({ scheme: "scoutable-stats", path: "auth/callback" });

/** Browser PKCE round-trip through Supabase's Google/Apple providers. False = cancelled. */
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

export function isNativeAppleAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return Promise.resolve(false);
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/**
 * Native Sign in with Apple (what App Review expects on iOS). Requires this
 * app's bundle id (se.scoutable.stats) in the Supabase Apple provider's
 * Client IDs list. False = the user dismissed the sheet.
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
    if ((e as { code?: string })?.code === "ERR_REQUEST_CANCELED") return false;
    throw e;
  }
  if (!credential.identityToken) throw new Error("Apple didn't return an identity token");
  const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken });
  if (error) throw new Error(error.message);
  return true;
}
