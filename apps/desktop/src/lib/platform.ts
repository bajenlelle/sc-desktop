/**
 * The one platform signal the webview has without a round-trip. WKWebView
 * always carries "Macintosh"; WebView2 carries "Windows". Everything
 * macOS-specific in CSS keys off `html[data-platform]`, set before first
 * paint from main.tsx, so Windows keeps its standard window and opaque chrome.
 */
export type Platform = "macos" | "windows" | "other";

export const PLATFORM: Platform = /Macintosh/.test(navigator.userAgent)
  ? "macos"
  : /Windows/.test(navigator.userAgent)
    ? "windows"
    : "other";

export const IS_MACOS = PLATFORM === "macos";

export function applyPlatformAttribute() {
  document.documentElement.dataset.platform = PLATFORM;
}
