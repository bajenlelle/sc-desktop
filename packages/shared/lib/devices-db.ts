/**
 * Device registry (anti-account-sharing v1). Each app persists a generated
 * device UUID and calls `touchDevice` on sign-in / app start; rows are
 * per (user, device) so shared-account patterns stay visible over time.
 * Writes go through a SECURITY DEFINER RPC; owners read their own rows via
 * RLS for the profile "Devices" section.
 *
 * touch errors are reported and swallowed: registry plumbing must never
 * break sign-in or app start.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";

export interface UserDevice {
  deviceId: string;
  app: "web" | "desktop" | "mobile";
  platform: string | null;
  deviceName: string | null;
  firstSeen: string;
  lastSeen: string;
}

export interface DeviceOutlier {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  orgs: string[];
  cap: number;
  activeDevices: number;
  devices: Array<{
    app: string;
    platform: string | null;
    device_name: string | null;
    first_seen: string;
    last_seen: string;
  }>;
}

export async function touchDevice(
  supabase: SupabaseClient,
  params: {
    deviceId: string;
    app: "web" | "desktop" | "mobile";
    platform?: string | null;
    deviceName?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.rpc("touch_device", {
    p_device_id: params.deviceId,
    p_app: params.app,
    p_platform: params.platform ?? null,
    p_device_name: params.deviceName ?? null,
  });
  if (error) reportDbError("touchDevice", error);
}

export async function listMyDevices(supabase: SupabaseClient): Promise<UserDevice[]> {
  const { data, error } = await supabase
    .from("user_devices")
    .select("device_id, app, platform, device_name, first_seen, last_seen")
    .order("last_seen", { ascending: false });
  if (error) {
    reportDbError("listMyDevices", error);
    throw error;
  }
  return (data ?? []).map((r) => ({
    deviceId: r.device_id as string,
    app: r.app as UserDevice["app"],
    platform: (r.platform as string | null) ?? null,
    deviceName: (r.device_name as string | null) ?? null,
    firstSeen: r.first_seen as string,
    lastSeen: r.last_seen as string,
  }));
}

/** Platform-admin only: accounts whose 30-day active device count exceeds their cap. */
export async function listDeviceOutliers(supabase: SupabaseClient): Promise<DeviceOutlier[]> {
  const { data, error } = await supabase.rpc("list_device_outliers");
  if (error) {
    reportDbError("listDeviceOutliers", error);
    throw error;
  }
  type Row = {
    user_id: string;
    full_name: string | null;
    email: string | null;
    role: string;
    orgs: string[];
    cap: number;
    active_devices: number;
    devices: DeviceOutlier["devices"];
  };
  return ((data ?? []) as Row[]).map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    orgs: r.orgs ?? [],
    cap: r.cap,
    activeDevices: r.active_devices,
    devices: r.devices ?? [],
  }));
}

/**
 * Companion to signOut({ scope: "others" }): revoking refresh tokens does not
 * unregister push, so evicted devices would keep receiving notifications.
 * Mobile passes its own token to keep; web/desktop pass nothing (delete all).
 */
export async function pruneOtherPushTokens(
  supabase: SupabaseClient,
  keepToken?: string | null
): Promise<void> {
  const { error } = await supabase.rpc("prune_other_push_tokens", {
    p_keep_token: keepToken ?? null,
  });
  if (error) reportDbError("pruneOtherPushTokens", error);
}
