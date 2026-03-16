/**
 * Utilities for serving local video files via the custom stream:// protocol.
 *
 * The stream:// protocol (registered in src-tauri/src/lib.rs) always caps
 * responses at 4 MiB and returns 206 Partial Content with a correct
 * Content-Range header, so WKWebView learns the total file size and makes
 * proper range requests. This avoids the OOM crash from Tauri's built-in
 * asset:// handler buffering entire large files (7–8 GB) into RAM.
 */

export function isLocalPath(url: string): boolean {
  return !url.startsWith("http://") && !url.startsWith("https://");
}

export function streamFileSrc(localPath: string): string {
  const encoded = localPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `stream://localhost${encoded}`;
}
