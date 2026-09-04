/**
 * Small localStorage-backed preferences, matching the app's existing
 * raw-localStorage pattern (scoutable_active_org_id etc.).
 */

const EXPORT_WATERMARK_OFF = "scoutable_export_watermark_off";

/**
 * Whether the user disabled the watermark on "Save to computer" exports.
 * Only honored for pro/franchise plans — callers gate on tier, and the
 * send-to-phone path ignores it entirely (always watermarked).
 */
export function getExportWatermarkDisabled(): boolean {
  return localStorage.getItem(EXPORT_WATERMARK_OFF) === "1";
}

export function setExportWatermarkDisabled(disabled: boolean): void {
  if (disabled) {
    localStorage.setItem(EXPORT_WATERMARK_OFF, "1");
  } else {
    localStorage.removeItem(EXPORT_WATERMARK_OFF);
  }
}

/**
 * "Has this user ever exported a playlist on this device" — drives the
 * Getting Started export step, which leaves no server trace. Namespaced per
 * user: the legacy un-namespaced `scoutable_has_exported` key pre-checked the
 * step for every later account on a shared machine, so it is deliberately
 * ignored (not migrated, not deleted).
 */
export function getHasExported(userId: string | undefined): boolean {
  return !!userId && localStorage.getItem(`scoutable_has_exported:${userId}`) === "1";
}

export function setHasExported(userId: string | undefined): void {
  if (userId) localStorage.setItem(`scoutable_has_exported:${userId}`, "1");
}
