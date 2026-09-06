/**
 * Anti-account-sharing device registry. V2: identity is the MACHINE, not the
 * webview — a Rust command hashes the hardware machine id (raw id never
 * reaches JS) and the server canonicalizes it per user. The legacy
 * localStorage UUID is collapsed into the hardware row on first contact via
 * the two-key state machine in shared/lib/device-boot.ts; until the server
 * confirms, the stored id IS the legacy id and gets resent as
 * replacesDeviceId every boot. The webview UA masquerades as a browser, so
 * the label uses the hostname (or names the desktop app explicitly).
 */
import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { touchDevice, type TouchVerdict } from "@scoutable/shared/lib/devices-db";
import {
  applyVerdict,
  DEVICE_ID_KEY,
  DEVICE_ID_SOURCE_KEY,
  planDeviceTouch,
} from "@scoutable/shared/lib/device-boot";
import { describeUserAgent } from "@scoutable/shared/lib/device-info";
import { trackEvent } from "@/lib/analytics";

interface DeviceIdentity {
  hardwareId: string;
  hostName: string | null;
}

// One invoke per app run; failure (Err) is memoized too — the legacy path is
// the fallback either way, and a machine id doesn't change mid-session.
let identityPromise: Promise<DeviceIdentity | null> | null = null;
function getIdentity(): Promise<DeviceIdentity | null> {
  identityPromise ??= invoke<DeviceIdentity>("get_device_identity").catch(() => null);
  return identityPromise;
}

/** Synchronous read for "This device" badge comparisons. Mints a legacy uuid
 * on first run; overwritten with the server-canonical id after migration. */
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

export async function touchThisDevice(): Promise<TouchVerdict | null> {
  const storedId = getDeviceId();
  if (!storedId) return null;
  let source: string | null = null;
  try {
    source = window.localStorage.getItem(DEVICE_ID_SOURCE_KEY);
  } catch {
    // Storage readable enough to have given us an id; treat as legacy.
  }

  const identity = await getIdentity();
  const plan = planDeviceTouch({ storedId, source }, identity?.hardwareId ?? null);
  if (!plan.deviceId && !plan.hardwareId) return null;

  const { platform } = describeUserAgent(navigator.userAgent);
  const verdict = await touchDevice(createClient(), {
    deviceId: plan.deviceId ?? storedId,
    app: "desktop",
    platform,
    deviceName: identity?.hostName ?? `Desktop app on ${platform}`,
    hardwareId: plan.hardwareId,
    replacesDeviceId: plan.replacesDeviceId,
  });

  const writes = applyVerdict({ storedId, source }, plan.hardwareId, verdict);
  if (writes) {
    try {
      window.localStorage.setItem(DEVICE_ID_KEY, writes.nextId);
      window.localStorage.setItem(DEVICE_ID_SOURCE_KEY, writes.nextSource);
      trackEvent("device_identity_migrated", { had_legacy: plan.replacesDeviceId != null });
    } catch {
      // Storage write failed — next boot redoes the migration (server-side
      // collapse of a missing row is a no-op).
    }
  }
  return verdict;
}
