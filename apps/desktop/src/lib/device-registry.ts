/**
 * Anti-account-sharing device registry: this install gets a persistent UUID
 * and announces itself via touch_device on sign-in / app start. The webview
 * UA masquerades as a browser, so the label names the desktop app explicitly.
 */
import { createClient } from "@/lib/supabase/client";
import { touchDevice } from "@scoutable/shared/lib/devices-db";
import { describeUserAgent } from "@scoutable/shared/lib/device-info";

const DEVICE_ID_KEY = "scoutable_device_id";

export function getDeviceId(): string | null {
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function touchThisDevice(): void {
  const deviceId = getDeviceId();
  if (!deviceId) return;
  const { platform } = describeUserAgent(navigator.userAgent);
  void touchDevice(createClient(), {
    deviceId,
    app: "desktop",
    platform,
    deviceName: `Desktop app on ${platform}`,
  });
}
