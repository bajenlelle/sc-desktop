/**
 * Pure logic for the device-registry boot flow, shared by desktop and mobile
 * (web needs only reconcileWebDeviceId — it has no hardware identity).
 *
 * Identity migration is a two-key state machine over the app's local storage:
 *   scoutable_device_id         — THE id, used for touch calls and the
 *                                 "This device" badge. Overwritten in place
 *                                 with the server-canonical uuid once a
 *                                 hardware touch succeeds.
 *   scoutable_device_id_source  — absent = the stored id is a legacy random
 *                                 uuid; "hardware" = migrated. The marker is
 *                                 written only AFTER the server confirms
 *                                 (verdict ok), so crashes are safe and
 *                                 `replacesDeviceId` is resent every boot
 *                                 until then (replacing a missing row is a
 *                                 server-side no-op).
 */

import type { TouchVerdict, UserDevice } from "./devices-db";

export const DEVICE_ID_KEY = "scoutable_device_id";
export const DEVICE_ID_SOURCE_KEY = "scoutable_device_id_source";
export const DEVICE_ID_SOURCE_HARDWARE = "hardware";

export interface DeviceIdState {
  /** Value of scoutable_device_id (legacy or canonical uuid), or null. */
  storedId: string | null;
  /** Value of scoutable_device_id_source ("hardware" once migrated). */
  source: string | null;
}

/** The touch params the boot flow should send for a given local state. */
export function planDeviceTouch(
  state: DeviceIdState,
  hardwareId: string | null,
): { deviceId: string | null; hardwareId: string | null; replacesDeviceId: string | null } {
  if (!hardwareId) {
    // No hardware identity (command failed / IDFV unavailable): legacy path,
    // exactly the v1 behavior. Never send replaces without a hardware id —
    // it would collapse the row we're about to touch.
    return { deviceId: state.storedId, hardwareId: null, replacesDeviceId: null };
  }
  const migrated = state.source === DEVICE_ID_SOURCE_HARDWARE;
  return {
    deviceId: state.storedId,
    hardwareId,
    // Until the server confirms, the stored id IS the legacy id to collapse.
    replacesDeviceId: migrated ? null : state.storedId,
  };
}

/**
 * Local writes to apply after a touch. null = write nothing (error verdicts,
 * legacy path, or already up to date).
 */
export function applyVerdict(
  state: DeviceIdState,
  sentHardwareId: string | null,
  verdict: TouchVerdict | null,
): { nextId: string; nextSource: string } | null {
  if (!verdict || verdict.status !== "ok" || !sentHardwareId) return null;
  if (state.source === DEVICE_ID_SOURCE_HARDWARE && state.storedId === verdict.deviceId) {
    return null;
  }
  return { nextId: verdict.deviceId, nextSource: DEVICE_ID_SOURCE_HARDWARE };
}

/** Devices split at the cap's activity window for the profile list. */
export function partitionDevicesByActivity(
  devices: UserDevice[],
  now: Date = new Date(),
  windowDays = 30,
): { active: UserDevice[]; inactive: UserDevice[] } {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const active: UserDevice[] = [];
  const inactive: UserDevice[] = [];
  for (const d of devices) {
    (new Date(d.lastSeen).getTime() > cutoff ? active : inactive).push(d);
  }
  return { active, inactive };
}

/** Honest row labels: a web row is a browser profile, not a device. */
export function appKindLabel(app: UserDevice["app"]): string {
  switch (app) {
    case "web":
      return "Browser";
    case "desktop":
      return "Desktop app";
    case "mobile":
      return "Mobile app";
  }
}

/**
 * Web-only: reconcile the localStorage id with its cookie mirror so clearing
 * localStorage alone no longer mints a new "device". localStorage wins a
 * mismatch — it predates the cookie, keeping existing registry rows
 * continuous. Returns the id to use plus which stores need (re)writing;
 * null means neither store is usable (caller skips registration).
 */
export function reconcileWebDeviceId(
  lsValue: string | null,
  cookieValue: string | null,
  mint: () => string,
): { id: string; writeLs: boolean; writeCookie: boolean } | null {
  if (lsValue) {
    return { id: lsValue, writeLs: false, writeCookie: cookieValue !== lsValue };
  }
  if (cookieValue) {
    return { id: cookieValue, writeLs: true, writeCookie: false };
  }
  const id = mint();
  return { id, writeLs: true, writeCookie: true };
}
