import { invoke } from "@tauri-apps/api/core";
import { isLocalPath } from "@/lib/stream";
import { probeVideoPath, videoBasename } from "@/lib/video-probe";
import { uploadToR2 } from "@/lib/r2-upload";
import { updateClipR2Url } from "@/lib/playlists-db";
import { clipBounds, clipShipKey, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import type { ClipShipFailure, ClipShipResult } from "@scoutable/shared/lib/ship-result";
import type { ExportSegment } from "@/lib/export";
import type { Playlist } from "@/types/match";

type ClipSegment = Extract<ExportSegment, { kind: "clip" }>;

/**
 * Clip & Ship: per-clip pipeline.
 *
 * For each clip segment: export with ship-quality FFmpeg settings (960×540,
 * CRF 28), upload to R2, persist the URL to playlist_clips.r2_url, delete
 * the temp file (best-effort). Serial on purpose — the ffmpeg sidecar is the
 * bottleneck and one video file at a time keeps disk/IPC pressure sane.
 *
 * Failure containment: a failing clip is recorded and the loop continues;
 * failed clips get ONE automatic retry pass at the end. The returned result
 * carries what shipped, what failed (after retry), and every uploaded URL so
 * callers can patch their in-memory playlist — which is also what makes a
 * user-driven "try again" idempotent.
 *
 * Idempotent: clips that already have r2Url on their PlaylistClipItem are
 * skipped. Aborting via opts.signal stops between clips (an in-flight ffmpeg
 * export can't be cancelled; the R2 upload can) and reports aborted — never
 * a failure.
 */
export async function clipAndShip(
  playlist: Playlist,
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  opts?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
): Promise<ClipShipResult> {
  const clipSegments = segments.filter((s): s is ClipSegment => s.kind === "clip");

  // Programming/state error, not a per-clip failure: nothing can ship
  // without local video, so surface it before touching anything.
  for (const seg of clipSegments) {
    if (!isLocalPath(seg.videoPath))
      throw new Error(`Clip & Ship requires a local video file (got: ${seg.videoPath})`);
  }
  // Machine-switch guard: a moved/deleted file would otherwise fail every
  // clip twice (the run + the automatic retry) with raw ffmpeg stderr.
  {
    const paths = [...new Set(clipSegments.map((s) => s.videoPath))];
    const probes = await Promise.all(paths.map((p) => probeVideoPath(p)));
    const gone = paths.find((_, i) => probes[i].status !== "ok");
    if (gone) {
      throw new Error(
        `The video file for "${videoBasename(gone)}" isn't on this computer — open the game in the Library and locate it.`,
      );
    }
  }

  const tempDir = await invoke<string>("get_temp_dir");
  const total = clipSegments.length;
  const result: ClipShipResult = { shipped: 0, skipped: 0, failures: [], uploaded: [], aborted: false };
  /** Uploaded during this run — keeps the retry pass from re-uploading. */
  const uploadedKeys = new Set<string>();
  let done = 0;

  async function shipOne(seg: ClipSegment): Promise<ClipShipFailure | null> {
    const { event, syncPoint } = seg;
    const t = computeVideoTime(event, syncPoint);
    if (t === null) {
      result.skipped++;
      return null;
    }
    const { start, end } = clipBounds(t, preRoll, postRoll, seg.preRollOffset, seg.postRollOffset);

    // Idempotent: skip if this clip was already uploaded (persisted state or
    // earlier in this run).
    const itemKey = `${seg.matchId}:${event.eventId}`;
    const existingClip = playlist.items.find(
      (item) =>
        item.type === "clip" &&
        item.matchId === seg.matchId &&
        item.eventId === event.eventId
    );
    if ((existingClip?.type === "clip" && existingClip.r2Url) || uploadedKeys.has(itemKey)) {
      result.skipped++;
      return null;
    }

    const tempPath = `${tempDir}/sc_ship_${Date.now()}.mp4`;
    try {
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
      const r2Url = await uploadToR2(tempPath, key, undefined, opts?.signal);

      // Persist the URL BEFORE deleting the temp file: a failed delete must
      // never leave an uploaded clip invisible (URL unrecorded).
      await updateClipR2Url(playlist.id, seg.matchId, event.eventId, r2Url);
      uploadedKeys.add(itemKey);
      result.shipped++;
      result.uploaded.push({ matchId: seg.matchId, eventId: event.eventId, r2Url });
      return null;
    } catch (e) {
      if (opts?.signal?.aborted) return null; // aborted mid-upload, not a failure
      return {
        matchId: seg.matchId,
        eventId: event.eventId,
        message: e instanceof Error ? e.message : String(e),
      };
    } finally {
      await invoke<void>("delete_file", { path: tempPath }).catch(() => {});
    }
  }

  const firstPassFailures: Array<{ seg: ClipSegment; failure: ClipShipFailure }> = [];
  for (const seg of clipSegments) {
    if (opts?.signal?.aborted) {
      result.aborted = true;
      return result;
    }
    const failure = await shipOne(seg);
    if (failure) firstPassFailures.push({ seg, failure });
    done++;
    opts?.onProgress?.(done, total);
  }

  // One automatic retry over the failures — transient network/disk hiccups
  // shouldn't need a human decision.
  for (const { seg, failure } of firstPassFailures) {
    if (opts?.signal?.aborted) {
      result.aborted = true;
      result.failures.push(failure);
      continue;
    }
    const retryFailure = await shipOne(seg);
    if (retryFailure) result.failures.push(retryFailure);
  }

  if (opts?.signal?.aborted) result.aborted = true;
  return result;
}
