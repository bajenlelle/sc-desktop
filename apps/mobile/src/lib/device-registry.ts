/**
 * Anti-account-sharing device registry. V2: identity is the HANDSET, not the
 * install — iOS IDFV / Android SSAID (prefixed, lowercased) goes up as
 * hardware_id and the server canonicalizes it per user (per-user-salted hash;
 * the raw id is never stored server-side). The legacy AsyncStorage UUID is
 * collapsed into the hardware row on first contact via the two-key state
 * machine in shared/lib/device-boot.ts; until the server confirms, the stored
 * id IS the legacy id and gets resent as replacesDeviceId every boot. When no
 * hardware id is available (IDFV null, dud SSAID) the per-install UUID path
 * remains — exactly the v1 behavior. Label comes from the real device name so
 * the profile Devices list reads naturally ("Leonards iPhone").
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Application from "expo-application";
import * as Device from "expo-device";
import type { SupabaseClient } from "@supabase/supabase-js";
import { touchDevice, type TouchVerdict } from "@scoutable/shared/lib/devices-db";
import {
  applyVerdict,
  DEVICE_ID_KEY,
  DEVICE_ID_SOURCE_KEY,
  planDeviceTouch,
} from "@scoutable/shared/lib/device-boot";
import { trackEvent } from "@/lib/analytics";

/** The classic SSAID returned by broken/emulated Android builds — shared by
 * thousands of devices, so it must never become an identity. */
const ANDROID_DUD_SSAID = "9774d56d682e549c";

// One lookup per app run; failure is memoized too — the legacy path is the
// fallback either way, and a hardware id doesn't change mid-session.
let hardwareIdPromise: Promise<string | null> | null = null;

async function computeHardwareId(): Promise<string | null> {
  try {
    if (Platform.OS === "ios") {
      const idfv = await Application.getIosIdForVendorAsync();
      return idfv ? `ios:${idfv.toLowerCase()}` : null;
    }
    if (Platform.OS === "android") {
      const ssaid = Application.getAndroidId();
      if (!ssaid || ssaid.toLowerCase() === ANDROID_DUD_SSAID) return null;
      return `and:${ssaid.toLowerCase()}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function getHardwareId(): Promise<string | null> {
  hardwareIdPromise ??= computeHardwareId();
  return hardwareIdPromise;
}

/** RFC 4122 v4 via Math.random — device ids don't need crypto strength. */
function uuid4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Read for "This device" badge comparisons. Mints a legacy uuid on first
 * run; overwritten with the server-canonical id after migration. */
export async function getDeviceId(): Promise<string | null> {
  try {
    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uuid4();
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export async function touchThisDevice(supabase: SupabaseClient): Promise<TouchVerdict | null> {
  const storedId = await getDeviceId();
  if (!storedId) return null;
  let source: string | null = null;
  try {
    source = await AsyncStorage.getItem(DEVICE_ID_SOURCE_KEY);
  } catch {
    // Storage readable enough to have given us an id; treat as legacy.
  }

  const hardwareId = await getHardwareId();
  const plan = planDeviceTouch({ storedId, source }, hardwareId);
  if (!plan.deviceId && !plan.hardwareId) return null;

  const os = Platform.OS === "ios" ? "iOS" : "Android";
  const verdict = await touchDevice(supabase, {
    deviceId: plan.deviceId ?? storedId,
    app: "mobile",
    platform: Device.osVersion ? `${os} ${Device.osVersion}` : os,
    deviceName: Device.deviceName ?? `${os} device`,
    hardwareId: plan.hardwareId,
    replacesDeviceId: plan.replacesDeviceId,
  });

  const writes = applyVerdict({ storedId, source }, plan.hardwareId, verdict);
  if (writes) {
    try {
      await AsyncStorage.setItem(DEVICE_ID_KEY, writes.nextId);
      await AsyncStorage.setItem(DEVICE_ID_SOURCE_KEY, writes.nextSource);
      trackEvent("device_identity_migrated", { had_legacy: plan.replacesDeviceId != null });
    } catch {
      // Storage write failed — next boot redoes the migration (server-side
      // collapse of a missing row is a no-op).
    }
  }
  return verdict;
}
