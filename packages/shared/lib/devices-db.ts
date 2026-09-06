/**
 * Device registry (anti-account-sharing). Each app calls `touchDevice` on
 * sign-in / app start; rows are per (user, device) so shared-account patterns
 * stay visible over time. V2: desktop/mobile send a hardware-derived id the
 * server canonicalizes (per-user-salted hash — raw ids are never stored) and
 * touch returns a gate verdict; web stays per-browser (no hardware identity
 * exists in a browser, and fingerprinting is off the table).
 * Writes go through SECURITY DEFINER RPCs; owners read their own rows via
 * RLS for the profile "Devices" section.
 *
 * touch failures resolve to null — reported, never thrown: registry plumbing
 * must never break sign-in or app start. A `blocked` verdict is a successful
 * call, not an error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";

export interface TouchVerdict {
  status: "ok" | "blocked";
  /** Server-canonical row id — hardware clients persist this (it can differ
   * from the deviceId they sent) so "This device" comparisons keep working. */
  deviceId: string;
  /** ok: active devices in the window INCLUDING this one; blocked: devices
   * currently holding slots. */
  activeCount: number;
  cap: number;
}

/** Defensive jsonb parsing: an old server returns void, a proxy might return
 * anything — only a well-formed verdict comes back typed, all else is null. */
export function parseTouchVerdict(data: unknown): TouchVerdict | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.status !== "ok" && d.status !== "blocked") return null;
  if (typeof d.device_id !== "string") return null;
  if (typeof d.active_count !== "number" || typeof d.cap !== "number") return null;
  return {
    status: d.status,
    deviceId: d.device_id,
    activeCount: d.active_count,
    cap: d.cap,
  };
}

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
  /** Over-cap registration attempts in the last 30 days (gate pressure —
   * recorded even while the gate flag is off). */
  blocked30d: number;
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
    /** "dt:<sha256hex>" (desktop) | "ios:<idfv>" | "and:<ssaid>" — server
     * hashes with a per-user salt before storing. Web never sends one. */
    hardwareId?: string | null;
    /** Legacy random-uuid row to collapse into the hardware-derived one.
     * Resent every boot until a verdict confirms the migration. */
    replacesDeviceId?: string | null;
  }
): Promise<TouchVerdict | null> {
  const { data, error } = await supabase.rpc("touch_device", {
    p_device_id: params.deviceId,
    p_app: params.app,
    p_platform: params.platform ?? null,
    p_device_name: params.deviceName ?? null,
    p_hardware_id: params.hardwareId ?? null,
    p_replaces_device_id: params.replacesDeviceId ?? null,
  });
  if (error) {
    reportDbError("touchDevice", error);
    return null;
  }
  return parseTouchVerdict(data);
}

/**
 * Self-service eviction (profile Devices section + the gate screen). Deletes
 * the registry row only — sessions can't be revoked per device; the evicted
 * device's next boot touch returns blocked while the cap is full.
 * Throws so callers can toast; error tokens: device_not_found, invalid_device.
 */
export async function removeDevice(supabase: SupabaseClient, deviceId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_device", { p_device_id: deviceId });
  if (error) {
    reportDbError("removeDevice", error);
    throw error;
  }
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
    blocked_30d?: number;
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
    blocked30d: r.blocked_30d ?? 0,
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
