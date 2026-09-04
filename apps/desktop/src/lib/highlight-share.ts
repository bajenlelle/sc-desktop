/**
 * "Send to phone": render the playlist to a temp MP4, upload it to R2 under
 * an unguessable per-user key, record a 30-day share row, and return the
 * public page URL (app.scoutable.se/h/{id}) for the QR code.
 */
import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { exportPlaylistToPath, type ExportSegment } from "@/lib/export";
import { uploadToR2 } from "@/lib/r2-upload";
import { createHighlightShare } from "@/lib/highlight-shares-db";
import { highlightContentKey, highlightShareKeys } from "@scoutable/shared/lib/highlight-shares-db";

const APP_URL = "https://app.scoutable.se";

export type SendToPhoneStage = "rendering" | "uploading" | "saving";

export async function sendHighlightToPhone(
  playlist: { id: string; name: string },
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  onStage?: (stage: SendToPhoneStage) => void,
  vertical = false,
): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const shareId = crypto.randomUUID();
  const tempDir = await invoke<string>("get_temp_dir");
  // Must stay inside the temp dir — delete_file's sandbox rejects anything else.
  const stamp = Date.now();
  const tempPath = `${tempDir}/sc_highlight_${stamp}.mp4`;
  const posterTempPath = `${tempDir}/sc_highlight_${stamp}.jpg`;

  onStage?.("rendering");
  // Watermark always on: send-to-phone clips land on Instagram/TikTok —
  // this surface is public distribution regardless of the sender's plan.
  await exportPlaylistToPath(segments, preRoll, postRoll, tempPath, true, vertical);

  try {
    onStage?.("uploading");
    // Per-user, uuid-keyed — unlike Clip & Ship's guessable clip keys.
    const keys = highlightShareKeys(user.id, shareId);
    const r2Url = await uploadToR2(tempPath, keys.video);

    // Poster frame for the /h page's OG image and <video poster>.
    // Strictly best-effort: a rendered MP4 must never be lost to a
    // failed thumbnail, so any error just leaves poster_url null.
    let posterUrl: string | undefined;
    try {
      await invoke("extract_poster_frame", { videoPath: tempPath, outputPath: posterTempPath });
      posterUrl = await uploadToR2(posterTempPath, keys.poster, "image/jpeg");
    } catch {
      posterUrl = undefined;
    }

    onStage?.("saving");
    await createHighlightShare({
      id: shareId,
      playlistId: playlist.id,
      title: playlist.name,
      r2Url,
      r2Key: keys.video,
      clipCount: segments.filter((s) => s.kind === "clip").length,
      posterUrl,
      posterKey: posterUrl ? keys.poster : undefined,
      // Aspect + fingerprint make the row reusable ONLY for an identical
      // later send (same clips/order/rolls/crop pans, same orientation).
      aspect: vertical ? "9:16" : "16:9",
      contentKey: highlightContentKey(segments, preRoll, postRoll, vertical ? "9:16" : "16:9"),
    });

    return `${APP_URL}/h/${shareId}`;
  } finally {
    invoke("delete_file", { path: tempPath }).catch(() => {});
    invoke("delete_file", { path: posterTempPath }).catch(() => {});
  }
}
