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
  if (error) reportDbError("registerPushToken", error);
}

export async function deletePushToken(supabase: SupabaseClient, token: string): Promise<void> {
  const { error } = await supabase.rpc("delete_push_token", { p_token: token });
  if (error) reportDbError("deletePushToken", error);
}
