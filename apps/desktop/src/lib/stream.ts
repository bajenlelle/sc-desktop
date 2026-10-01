/**
 * Local video files are served over the custom `stream` protocol, whose
 * handler (src-tauri/src/lib.rs) caps every response at 4 MiB and answers
 * 206 with a Content-Range so the webview learns the total size and makes
 * proper range requests — Tauri's built-in asset:// buffered whole 7–8 GB
 * files into RAM.
 *
 * The URL form differs per OS, which is why this goes through Tauri rather
 * than string concatenation: `stream://localhost/…` on macOS, but
 * `http://stream.localhost/…` on Windows — the only form WebView2 routes to
 * a custom protocol. Hand-building `stream://` here is what left every
 * Windows video black (#66). Tauri percent-encodes the whole path, so the
 * Rust side strips the separator slash before decoding.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

/** True for a stored filesystem path (macOS or Windows), false for an http(s) URL. */
export function isLocalPath(url: string): boolean {
  return !url.startsWith("http://") && !url.startsWith("https://");
}

export function streamFileSrc(localPath: string): string {
  return convertFileSrc(localPath, "stream");
}
