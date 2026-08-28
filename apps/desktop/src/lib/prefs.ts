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
