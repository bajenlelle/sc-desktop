/**
 * Anti-account-sharing device registry: this browser gets a persistent UUID
 * and announces itself via touch_device on sign-in / app start. The label is
 * deliberately coarse ("Chrome on Windows") — shown back to the user on the
 * profile Devices section, never used for fingerprinting.
 */
import { createClient } from "@/lib/supabase/client";
import { touchDevice } from "@scoutable/shared/lib/devices-db";
import { describeUserAgent } from "@scoutable/shared/lib/device-info";

const DEVICE_ID_KEY = "scoutable_device_id";

export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked (private mode) — skip registration rather than churn ids.
    return null;
  }
}

export function touchThisDevice(): void {
  const deviceId = getDeviceId();
  if (!deviceId) return;
  const { platform, deviceName } = describeUserAgent(navigator.userAgent);
  void touchDevice(createClient(), { deviceId, app: "web", platform, deviceName });
}
