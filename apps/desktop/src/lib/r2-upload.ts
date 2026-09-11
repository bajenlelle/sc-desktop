import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { presignUpload, type UploadContentType } from "@scoutable/shared/lib/presign-upload-client";
import { createClient } from "@/lib/supabase/client";

/**
 * Upload a local file to Cloudflare R2. Returns the public URL.
 *
 * No R2 credentials live in this app: the presign-upload edge function
 * authorizes the key (owner / org coach-admin) and mints a short-lived
 * presigned PUT URL, which we hit through the Rust-side plugin-http fetch —
 * the webview never talks to R2, so no bucket CORS config is involved.
 *
 * Reads through the read_file Tauri command (raw bytes over IPC) — NOT
 * fetch() against stream://, whose responses cap at 4 MiB and whose headers
 * aren't readable cross-origin; that combination once silently truncated
 * every upload over 4 MiB. std::fs::read returns the whole file or errors.
 */
export async function uploadToR2(
  localPath: string,
  key: string,
  contentType: string = "video/mp4",
  signal?: AbortSignal,
): Promise<string> {
  const presign = await presignUpload(createClient(), key, contentType as UploadContentType);
  if (!presign.ok) throw new Error(`Upload not authorized (${presign.error})`);

  const body = new Uint8Array(await invoke<ArrayBuffer>("read_file", { path: localPath }));

  // Per-call signal bridge: the plugin-http fetch shim registers abort
  // listeners it never removes, and its Rust-side resource ids die when the
  // request completes. Callers (Clip & Ship) reuse ONE signal across a whole
  // run, so a Cancel pressed after N uploads finished used to fan out N stale
  // cleanup invokes -> "The resource id X is invalid" unhandled rejections
  // (issue #25). The inner controller scopes each fetch's listeners to that
  // fetch; mid-upload cancellation behaves exactly as before.
  const perCall = new AbortController();
  const onAbort = () => perCall.abort();
  if (signal?.aborted) perCall.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await tauriFetch(presign.data.uploadUrl, {
      method: "PUT",
      // Must equal the contentType we presigned — it's in the signed headers.
      headers: { "Content-Type": contentType },
      body,
      signal: perCall.signal,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    // Drain the (empty) response so the plugin releases the Rust-side
    // response resource now instead of holding it for the window's lifetime.
    // Safe only with the per-call signal above — with a shared signal this
    // close is exactly the double-free the bridge exists to prevent.
    await res.body?.cancel();
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  return presign.data.publicUrl;
}
