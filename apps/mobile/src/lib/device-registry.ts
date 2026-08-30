/**
 * Anti-account-sharing device registry: this install gets a persistent UUID
 * (AsyncStorage; reinstall = new device, old rows age out of the 30-day
 * active window) and announces itself via touch_device on sign-in /
 * app start. Label comes from the real device name so the profile Devices
 * list reads naturally ("Leonards iPhone").
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Device from "expo-device";
import type { SupabaseClient } from "@supabase/supabase-js";
import { touchDevice } from "@scoutable/shared/lib/devices-db";

const DEVICE_ID_KEY = "scoutable_device_id";

/** RFC 4122 v4 via Math.random — device ids don't need crypto strength. */
function uuid4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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

export async function touchThisDevice(supabase: SupabaseClient): Promise<void> {
  const deviceId = await getDeviceId();
  if (!deviceId) return;
  const os = Platform.OS === "ios" ? "iOS" : "Android";
  await touchDevice(supabase, {
    deviceId,
    app: "mobile",
    platform: Device.osVersion ? `${os} ${Device.osVersion}` : os,
    deviceName: Device.deviceName ?? `${os} device`,
  });
}
