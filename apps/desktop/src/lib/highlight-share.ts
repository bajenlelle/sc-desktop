/**
 * "Send to phone": render the playlist to a temp MP4, upload it to R2 under
 * an unguessable per-user key, record a 30-day share row, and return the
 * public page URL (app.scoutable.se/h/{id}) for the QR code.
 */
import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { exportPlaylistToPath, type ExportProgress, type ExportSegment } from "@/lib/export";
import { uploadToR2 } from "@/lib/r2-upload";
import { createHighlightShare } from "@/lib/highlight-shares-db";
import { highlightContentKey, highlightShareKeys } from "@scoutable/shared/lib/highlight-shares-db";

const APP_URL = "https://app.scoutable.se";

/**
 * The fingerprint a later send must match to reuse this link. A highlight sent without the watermark is a different
 * video from the same plays sent with it.
 */
export function shareContentKey(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  vertical: boolean,
  highlight?: { watermark: boolean },
): string {
  const key = highlightContentKey(segments, preRoll, postRoll, vertical ? "9:16" : "16:9");
  return highlight && !highlight.watermark ? `${key}|nw` : key;
}

export type SendToPhoneStage = "rendering" | "uploading" | "saving";

export async function sendHighlightToPhone(
  /** A playlist, or a player's highlight video (id null). */
  playlist: { id: string | null; name: string },
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  onStage?: (stage: SendToPhoneStage) => void,
  vertical = false,
  onExportProgress?: (progress: ExportProgress) => void,
  /** Aborting stops the render (ffmpeg is killed) or the upload, whichever is running. */
  signal?: AbortSignal,
  /**
   * The player's highlight video: cut straight from clip to clip instead of the short fades, and its own watermark
   * rule (a player who paid can turn it off). Everything else sent to a phone is always watermarked.
   */
  highlight?: { hardCuts: boolean; watermark: boolean },
): Promise<string> {
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new DOMException("Send to phone cancelled", "AbortError");
  };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const shareId = crypto.randomUUID();
  const tempDir = await invoke<string>("get_temp_dir");
  // Must stay inside the temp dir — delete_file's sandbox rejects anything else.
  const stamp = Date.now();
  const tempPath = `${tempDir}/sc_highlight_${stamp}.mp4`;
  const posterTempPath = `${tempDir}/sc_highlight_${stamp}.jpg`;

  try {
    onStage?.("rendering");
    // Watermark always on: send-to-phone clips land on Instagram/TikTok;
    // this surface is public distribution regardless of the sender's plan.
    // The signal stops the render itself, not only what comes after it.
    await exportPlaylistToPath(segments, preRoll, postRoll, tempPath, highlight?.watermark ?? true, vertical, {
      onProgress: onExportProgress,
      signal,
      ...(highlight?.hardCuts ? { hardCuts: true } : {}),
    });
    stopIfCancelled();
    onStage?.("uploading");
    // Per-user, uuid-keyed — unlike Clip & Ship's guessable clip keys.
    const keys = highlightShareKeys(user.id, shareId);
    const r2Url = await uploadToR2(tempPath, keys.video, "video/mp4", signal);
    stopIfCancelled();

    // Poster frame for the /h page's OG image and <video poster>.
    // Strictly best-effort: a rendered MP4 must never be lost to a
    // failed thumbnail, so any error just leaves poster_url null.
    let posterUrl: string | undefined;
    try {
      await invoke("extract_poster_frame", { videoPath: tempPath, outputPath: posterTempPath });
      posterUrl = await uploadToR2(posterTempPath, keys.poster, "image/jpeg", signal);
    } catch {
      posterUrl = undefined;
    }

    stopIfCancelled();
    onStage?.("saving");
    await createHighlightShare({
      id: shareId,
      playlistId: playlist.id ?? undefined,
      title: playlist.name,
      r2Url,
      r2Key: keys.video,
      clipCount: segments.filter((s) => s.kind === "clip").length,
      posterUrl,
      posterKey: posterUrl ? keys.poster : undefined,
      // Aspect + fingerprint make the row reusable ONLY for an identical
      // later send (same clips/order/rolls/crop pans, same orientation).
      aspect: vertical ? "9:16" : "16:9",
      contentKey: shareContentKey(segments, preRoll, postRoll, vertical, highlight),
    });

    return `${APP_URL}/h/${shareId}`;
  } finally {
    invoke("delete_file", { path: tempPath }).catch(() => {});
    invoke("delete_file", { path: posterTempPath }).catch(() => {});
  }
}
