/**
 * Client for the `presign-upload` edge function — the only road to writing R2
 * objects from an app.
 *
 * The function holds the R2 credentials (never shipped to clients), validates
 * the submitted key against the golden-tested formats (clipShipKey /
 * highlightShareKeys), authorizes the caller (match owner or org coach/admin
 * for clips; own uid for highlights), and returns a short-lived presigned PUT
 * URL plus the canonical public URL that gets persisted into DB rows.
 * JWT-authed like genius; the invoke pattern and error-token handling mirror
 * genius-client.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type UploadContentType = "video/mp4" | "image/jpeg";

export interface PresignedUpload {
  /** SigV4 query-signed PUT URL, valid ~15 min from minting. */
  uploadUrl: string;
  /** Public URL of the object once uploaded — safe to persist. */
  publicUrl: string;
}

export type PresignResult = { ok: true; data: PresignedUpload } | { ok: false; error: string };

export async function presignUpload(
  supabase: SupabaseClient,
  key: string,
  contentType: UploadContentType,
): Promise<PresignResult> {
  const { data, error } = await supabase.functions.invoke("presign-upload", {
    body: { key, contentType },
  });
  if (error) {
    // FunctionsHttpError carries the response; surface the snake token when present.
    let token = "request_failed";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        token = (await ctx.json())?.error ?? token;
      } catch {
        // keep generic token
      }
    }
    return { ok: false, error: token };
  }
  return { ok: true, data: data as PresignedUpload };
}
