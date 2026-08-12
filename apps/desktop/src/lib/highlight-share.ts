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

const APP_URL = "https://app.scoutable.se";

export type SendToPhoneStage = "rendering" | "uploading" | "saving";

export async function sendHighlightToPhone(
  playlist: { id: string; name: string },
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  onStage?: (stage: SendToPhoneStage) => void,
): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const shareId = crypto.randomUUID();
  const tempDir = await invoke<string>("get_temp_dir");
  // Must stay inside the temp dir — delete_file's sandbox rejects anything else.
  const tempPath = `${tempDir}/sc_highlight_${Date.now()}.mp4`;

  onStage?.("rendering");
  await exportPlaylistToPath(segments, preRoll, postRoll, tempPath);

  try {
    onStage?.("uploading");
    // Per-user, uuid-keyed — unlike Clip & Ship's guessable clip keys.
    const key = `highlights/${user.id}/${shareId}.mp4`;
    const r2Url = await uploadToR2(tempPath, key);

    onStage?.("saving");
    await createHighlightShare({
      id: shareId,
      playlistId: playlist.id,
      title: playlist.name,
      r2Url,
      r2Key: key,
      clipCount: segments.filter((s) => s.kind === "clip").length,
    });

    return `${APP_URL}/h/${shareId}`;
  } finally {
    invoke("delete_file", { path: tempPath }).catch(() => {});
  }
}
