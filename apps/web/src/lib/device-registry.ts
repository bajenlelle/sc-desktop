/**
 * Anti-account-sharing device registry, web edition. Honest limits: a device
 * row here is a BROWSER PROFILE, not a machine. The persistent UUID lives in
 * localStorage with a first-party cookie mirror, so clearing localStorage
 * alone no longer mints a new "device"; "Clear site data" wipes both and this
 * browser starts a new row. A different browser (or profile) on the same
 * machine is a different row by design. No fingerprinting — deliberate
 * (GDPR): the label is coarse ("Chrome on Windows"), shown back to the user
 * on the profile Devices section, never used for identification.
 */
import { createClient } from "@/lib/supabase/client";
import { touchDevice, type TouchVerdict } from "@scoutable/shared/lib/devices-db";
import { describeUserAgent } from "@scoutable/shared/lib/device-info";
import { DEVICE_ID_KEY, reconcileWebDeviceId } from "@scoutable/shared/lib/device-boot";

/** 400 days — the Chrome cookie-lifetime ceiling. */
const COOKIE_MAX_AGE_SECONDS = 34_560_000;

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

function writeCookie(name: string, id: string): void {
  // Secure only on https so localhost dev keeps working. Not HttpOnly — JS
  // owns this cookie; it exists purely as a mirror of the localStorage id.
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${id}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const lsValue = window.localStorage.getItem(DEVICE_ID_KEY);
    const cookieValue = readCookie(DEVICE_ID_KEY);
    const plan = reconcileWebDeviceId(lsValue, cookieValue, () => crypto.randomUUID());
    if (!plan) return null;
    if (plan.writeLs) window.localStorage.setItem(DEVICE_ID_KEY, plan.id);
    // Rewritten on every call — a mismatched or missing cookie gets healed,
    // and a matching one gets its Max-Age refreshed (rolling expiry).
    writeCookie(DEVICE_ID_KEY, plan.id);
    return plan.id;
  } catch {
    // Storage blocked (private mode) — skip registration rather than churn ids.
    return null;
  }
}

/**
 * Announce this browser via touch_device and return the gate verdict (null on
 * unusable storage or plumbing failure — never blocks sign-in). Web sends no
 * hardwareId/replacesDeviceId: the id never changes here, so there is nothing
 * to migrate.
 */
export async function touchThisDevice(): Promise<TouchVerdict | null> {
  const deviceId = getDeviceId();
  if (!deviceId) return null;
  const { platform, deviceName } = describeUserAgent(navigator.userAgent);
  return touchDevice(createClient(), { deviceId, app: "web", platform, deviceName });
}
