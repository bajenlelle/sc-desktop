import { invoke } from "@tauri-apps/api/core";
import { isLocalPath } from "@/lib/stream";
import { uploadToR2 } from "@/lib/r2-upload";
import { updateClipR2Url } from "@/lib/playlists-db";
import { clipBounds, clipShipKey, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import type { ExportSegment } from "@/lib/export";
import type { Playlist } from "@/types/match";

/**
 * Clip & Ship: per-clip pipeline.
 *
 * For each clip segment: export with ship-quality FFmpeg settings (960×540, CRF 28),
 * upload to R2, delete temp file, persist the URL back to playlist_clips.r2_url.
 *
 * Idempotent: clips that already have r2Url on their PlaylistClipItem are skipped.
 * onProgress is called after each clip with (done, total) counts.
 */
export async function clipAndShip(
  playlist: Playlist,
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const clipSegments = segments.filter(
    (s): s is Extract<ExportSegment, { kind: "clip" }> => s.kind === "clip"
  );

  for (const seg of clipSegments) {
    if (!isLocalPath(seg.videoPath))
      throw new Error(`Clip & Ship requires a local video file (got: ${seg.videoPath})`);
  }

  const tempDir = await invoke<string>("get_temp_dir");
  let done = 0;

  for (const seg of clipSegments) {
    const { event, syncPoint } = seg;
    const t = computeVideoTime(event, syncPoint);
    if (t === null) continue;
    const { start, end } = clipBounds(t, preRoll, postRoll, seg.preRollOffset, seg.postRollOffset);

    // Idempotent: skip if this clip was already uploaded
    const existingClip = playlist.items.find(
      (item) =>
        item.type === "clip" &&
        item.matchId === seg.matchId &&
        item.eventId === event.eventId
    );
    if (existingClip?.type === "clip" && existingClip.r2Url) {
      done++;
      onProgress?.(done, clipSegments.length);
      continue;
    }

    const ts = Date.now();
    const tempPath = `${tempDir}/sc_ship_${ts}.mp4`;

    await invoke<void>("export_clip_for_ship", {
      videoPath: seg.videoPath,
      start,
      end,
      outputPath: tempPath,
    });

    // Effective totals (base roll + per-clip offset) — the key format is
    // pinned by a golden test in shared; existing uploads are addressed by it.
    const key = clipShipKey(
      seg.matchId,
      event.eventId,
      preRoll + (seg.preRollOffset ?? 0),
      postRoll + (seg.postRollOffset ?? 0),
    );
    const r2Url = await uploadToR2(tempPath, key);

    await invoke<void>("delete_file", { path: tempPath });
    await updateClipR2Url(playlist.id, seg.matchId, event.eventId, r2Url);

    done++;
    onProgress?.(done, clipSegments.length);
  }
}
