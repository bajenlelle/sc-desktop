/**
 * Coarse, user-visible device labels from a browser user-agent string —
 * "Chrome on Windows", "Safari on macOS". Deliberately NOT fingerprinting:
 * no versions, no hardware signals. Used by web and desktop; mobile uses
 * expo-device's real device name instead.
 */

export interface DeviceInfo {
  /** OS family, e.g. "macOS", "Windows", "Linux", "iOS", "Android". */
  platform: string;
  /** Human label, e.g. "Chrome on Windows". */
  deviceName: string;
}

function detectOs(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

function detectBrowser(ua: string): string {
  // Order matters: most browsers embed competitors' tokens for compatibility.
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return "Browser";
}

export function describeUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { platform: "Unknown", deviceName: "Unknown device" };
  const platform = detectOs(ua);
  const browser = detectBrowser(ua);
  return { platform, deviceName: `${browser} on ${platform}` };
}
