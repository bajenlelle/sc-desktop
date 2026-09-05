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

  const res = await tauriFetch(presign.data.uploadUrl, {
    method: "PUT",
    // Must equal the contentType we presigned — it's in the signed headers.
    headers: { "Content-Type": contentType },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);

  return presign.data.publicUrl;
}
