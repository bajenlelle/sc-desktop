/**
 * Expo push-token registration. Rows in `push_tokens` are server-written —
 * both calls go through SECURITY DEFINER RPCs because a token must be able to
 * move between users on a shared device (registering reassigns the row;
 * deleting works regardless of owner since possessing the token string is
 * proof of device possession).
 *
 * Errors are reported and swallowed: notification plumbing must never break
 * sign-in or sign-out.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";

export async function registerPushToken(
  supabase: SupabaseClient,
  token: string,
  platform: "ios" | "android",
  deviceName?: string | null
): Promise<void> {
  const { error } = await supabase.rpc("register_push_token", {
    p_token: token,
    p_platform: platform,
    p_device_name: deviceName ?? null,
  });
  // not_authenticated is an expected race, not a defect: the session can
  // legitimately expire between the auth event that triggered registration
  // and this RPC (the caller re-registers on the next sign-in/primer). Every
  // other error still reports.
  if (error && !error.message.includes("not_authenticated")) {
    reportDbError("registerPushToken", error);
  }
}

export async function deletePushToken(supabase: SupabaseClient, token: string): Promise<void> {
  const { error } = await supabase.rpc("delete_push_token", { p_token: token });
  if (error) reportDbError("deletePushToken", error);
}
