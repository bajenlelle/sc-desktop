import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { isLocalPath } from "@/lib/stream";
import { probeVideoDuration, probeVideoPath, videoBasename } from "@/lib/video-probe";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { toSegmentKeyframes, type CropKeyframe } from "@scoutable/shared/lib/crop-path";
import { isExportCancelled, type ExportProgress } from "@scoutable/shared/lib/export-progress";
import { fallbackText, type StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import { cardPngBase64 } from "@/lib/card-painter";
import type { PlayByPlayEvent, SyncPoint } from "@/types/match";

export type { ExportProgress };

export interface ExportOptions {
  /** Per-segment render progress, then one "stitching" notification for the final concat pass. */
  onProgress?: (progress: ExportProgress) => void;
  /**
   * Aborting stops the render where it is: the Rust side kills ffmpeg and
   * deletes what it made, and the call rejects with an AbortError.
   */
  signal?: AbortSignal;
  /** Save to computer: the save panel returned a path and rendering starts. */
  onPathChosen?: () => void;
}

/** What an export that was stopped rejects with; see isExportCancelled. */
function exportStopped(): DOMException {
  return new DOMException("Export stopped", "AbortError");
}

/**
 * The one door to the Rust export command. A nonce keys this invocation: its
 * "export-progress" events (a save-export and a send-to-phone render can
 * overlap, so a listener never consumes another export's stream), and the
 * job `cancel_export` stops.
 */
async function invokeExportPlaylist(
  rustSegments: RustSegment[],
  outputPath: string,
  watermark: boolean,
  vertical: boolean,
  opts?: ExportOptions,
): Promise<void> {
  const { onProgress, signal } = opts ?? {};
  if (signal?.aborted) throw exportStopped();
  const progressId = crypto.randomUUID();
  const unlisten = onProgress
    ? await listen<ExportProgress & { id: string }>("export-progress", (event) => {
        if (event.payload.id !== progressId) return;
        const { phase, done, total } = event.payload;
        onProgress({ phase, done, total });
      })
    : null;
  const stop = () => void invoke<boolean>("cancel_export", { id: progressId }).catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await invoke<void>("export_playlist", { segments: rustSegments, outputPath, watermark, vertical, progressId });
  } catch (e) {
    throw isExportCancelled(e) ? exportStopped() : e;
  } finally {
    signal?.removeEventListener("abort", stop);
    unlisten?.();
  }
}

export type ExportSegment =
  | { kind: 'clip'; videoPath: string; matchId: string; event: PlayByPlayEvent; syncPoint: SyncPoint; preRollOffset?: number; postRollOffset?: number; cropKeyframes?: CropKeyframe[] }
  | { kind: 'text'; text: string; durationSeconds: number; card?: StatsCardSpec };

// Legacy interface kept for callers that haven't migrated yet
export interface ExportItem {
  videoPath: string;
  event: PlayByPlayEvent;
  syncPoint: SyncPoint;
  preRollOffset?: number;
  postRollOffset?: number;
}

type RustSegment =
  | { kind: 'clip'; video_path: string; start: number; end: number; crop_keyframes?: CropKeyframe[] }
  | { kind: 'text'; text: string; duration_seconds: number }
  | { kind: 'image'; png_base64: string; duration_seconds: number };

/**
 * Cards are drawn by the app (card-painter), so the export shows exactly
 * what the stage did. If drawing fails, the card still renders through
 * Rust's own text card; a stats card then shows its fallback line.
 */
async function cardSegment(
  seg: Extract<ExportSegment, { kind: 'text' }>,
  vertical: boolean,
): Promise<RustSegment> {
  try {
    const png = await cardPngBase64(seg, vertical ? "9:16" : "16:9");
    return { kind: 'image', png_base64: png, duration_seconds: seg.durationSeconds };
  } catch (e) {
    console.warn("Card drawing failed; exporting it as plain text", e);
    const text = seg.card ? fallbackText(seg.card) : seg.text;
    return { kind: 'text', text, duration_seconds: seg.durationSeconds };
  }
}

/**
 * A moved/deleted source file (machine switch) would otherwise surface as
 * raw ffmpeg stderr after a long wait — fail fast with a fixable message.
 */
async function assertVideosPresent(segments: ExportSegment[]): Promise<void> {
  const paths = [...new Set(
    segments.flatMap((s) => (s.kind === "clip" && isLocalPath(s.videoPath) ? [s.videoPath] : [])),
  )];
  const results = await Promise.all(paths.map((p) => probeVideoPath(p)));
  const gone = paths.find((_, i) => results[i].status !== "ok");
  if (gone) {
    throw new Error(
      `The video file for "${videoBasename(gone)}" can't be found — open the game in the Library and locate it.`,
    );
  }
}

function formatSeconds(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export interface ClipRangeFilter {
  /** Segments to render: every text card + clips inside their source. */
  kept: ExportSegment[];
  /** Clips dropped for starting past their source's end. */
  skipped: number;
  /** Human explanation naming the video and its length; null when skipped=0. */
  note: string | null;
}

/**
 * Drop clips whose window starts past the end of their source video. A coach
 * who imported only the first half still owns the first-half clips, so
 * out-of-range clips are skipped with a message, not a hard failure — callers
 * decide what "no clips left" means (that's the wrong-file case).
 *
 * Send-to-phone MUST filter with this BEFORE computing the reuse fingerprint:
 * the kept set is what actually renders, and folding it into the content key
 * means relinking the full recording later changes the key and forces a
 * fresh render instead of reusing a partial master.
 */
export async function dropClipsOutsideVideos(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
): Promise<ClipRangeFilter> {
  const paths = [...new Set(
    segments.flatMap((s) => (s.kind === "clip" && isLocalPath(s.videoPath) ? [s.videoPath] : [])),
  )];
  const durations = new Map(
    await Promise.all(
      paths.map(async (p): Promise<[string, number | null]> => [p, await probeVideoDuration(p)]),
    ),
  );

  let skipped = 0;
  const culprits: { path: string; duration: number }[] = [];
  const kept = segments.filter((seg) => {
    if (seg.kind !== "clip") return true;
    const duration = durations.get(seg.videoPath);
    // Unknown duration → keep; the Rust-side size check backstops it.
    if (duration == null) return true;
    const t = computeVideoTime(seg.event, seg.syncPoint);
    if (t === null) return true; // buildRustSegments drops these anyway
    const { start } = clipBounds(t, preRoll, postRoll, seg.preRollOffset, seg.postRollOffset);
    // Same epsilon as assertClipsWithinVideos: a clip "starting" in the
    // final quarter-second has no footage beyond its own fade.
    if (start < duration - 0.25) return true;
    skipped++;
    culprits.push({ path: seg.videoPath, duration });
    return false;
  });

  const blamed = culprits[0];
  const note = blamed
    ? `${skipped} ${skipped === 1 ? "clip falls" : "clips fall"} after ` +
      `"${videoBasename(blamed.path)}" ends (${formatSeconds(blamed.duration)}) — the video may ` +
      `only cover part of the game, so ${skipped === 1 ? "it was" : "they were"} left out.`
    : null;
  return { kept, skipped, note };
}

/**
 * A clip whose start lies past the end of its source renders zero frames:
 * ffmpeg still exits 0 and the MP4 muxer drops the empty tracks, so without
 * this check the failure surfaced as a cryptic concat error ("matches no
 * streams") after a long render. The usual cause is the wrong file linked
 * after a machine switch, or a bad sync point — name that fix. Unknown
 * durations are skipped: the Rust-side size check still backstops those.
 * Callers filter with dropClipsOutsideVideos first, so this firing means
 * the file changed underneath us mid-export.
 */
async function assertClipsWithinVideos(rustSegments: RustSegment[]): Promise<void> {
  const clips = rustSegments.filter((s) => s.kind === "clip");
  const paths = [...new Set(clips.map((c) => c.video_path))];
  const durations = new Map(
    await Promise.all(
      paths.map(async (p): Promise<[string, number | null]> => [p, await probeVideoDuration(p)]),
    ),
  );
  for (const [i, clip] of clips.entries()) {
    const duration = durations.get(clip.video_path);
    // Small epsilon: a clip "starting" in the final quarter-second is the
    // same symptom (fade alone outlasts the footage).
    if (duration != null && clip.start >= duration - 0.25) {
      throw new Error(
        `Clip ${i + 1} of ${clips.length} starts at ${formatSeconds(clip.start)}, but ` +
          `"${videoBasename(clip.video_path)}" is only ${formatSeconds(duration)} long. ` +
          `The video linked to this game may be the wrong file — open it in the Library ` +
          `and locate the right one, or re-set the sync point.`,
      );
    }
  }
}

async function buildRustSegments(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  vertical: boolean,
): Promise<RustSegment[]> {
  for (const seg of segments) {
    if (seg.kind === 'clip' && !isLocalPath(seg.videoPath))
      throw new Error("Export requires a local video file for every session.");
  }

  const cards = new Map<ExportSegment, RustSegment>();
  for (const seg of segments) {
    if (seg.kind === 'text') cards.set(seg, await cardSegment(seg, vertical));
  }

  const rustSegments: RustSegment[] = segments
    .map((seg): RustSegment | null => {
      if (seg.kind === 'text') return cards.get(seg) ?? null;
      const t = computeVideoTime(seg.event, seg.syncPoint);
      if (t === null) return null;
      const { start, end } = clipBounds(t, preRoll, postRoll, seg.preRollOffset, seg.postRollOffset);
      if (vertical) {
        // Stored keyframe times are absolute video seconds; ffmpeg's crop
        // expression sees t from the seek point, so rebase onto the clip.
        return {
          kind: 'clip',
          video_path: seg.videoPath,
          start,
          end,
          crop_keyframes: toSegmentKeyframes(seg.cropKeyframes, start, end),
        };
      }
      return { kind: 'clip', video_path: seg.videoPath, start, end };
    })
    .filter((s): s is RustSegment => s !== null);

  if (rustSegments.length === 0) throw new Error("No segments with valid video times.");
  return rustSegments;
}

/**
 * Render the playlist to a specific path — no dialog. Used by the
 * "send to phone" flow, which renders into the temp dir before uploading.
 * Callers must run dropClipsOutsideVideos first (the send-to-phone dialog
 * does) — the kept set has to feed the reuse fingerprint too, so filtering
 * here would let the content key drift from what was rendered.
 */
export async function exportPlaylistToPath(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  outputPath: string,
  watermark: boolean,
  vertical = false,
  opts?: ExportOptions,
): Promise<void> {
  await assertVideosPresent(segments);
  const rustSegments = await buildRustSegments(segments, preRoll, postRoll, vertical);
  await assertClipsWithinVideos(rustSegments);
  await invokeExportPlaylist(rustSegments, outputPath, watermark, vertical, opts);
}

/**
 * Returns the written file's path, or null when the user cancelled the save
 * dialog — so callers don't record the export as having happened.
 */
export async function exportPlaylist(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  playlistName: string,
  watermark: boolean,
  vertical = false,
  opts?: ExportOptions,
): Promise<string | null> {
  await assertVideosPresent(segments);
  // Partial recordings are legitimate (first half only) — export what the
  // video covers and say what was left out; only zero coverage is an error.
  const { kept, skipped, note } = await dropClipsOutsideVideos(segments, preRoll, postRoll);
  if (!kept.some((s) => s.kind === "clip")) {
    throw new Error(
      "None of the selected clips fall inside the linked video — it may be the wrong " +
        "file, or its sync point may be off. Open the game in the Library to relink or re-sync.",
    );
  }
  if (skipped > 0 && note) toast.warning(note, { duration: 8000 });
  const rustSegments = await buildRustSegments(kept, preRoll, postRoll, vertical);
  await assertClipsWithinVideos(rustSegments);

  const outputPath = await save({
    defaultPath: `${playlistName.replace(/[^a-z0-9]/gi, "_")}${vertical ? "_vertical" : ""}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
  });
  if (!outputPath) return null; // user cancelled

  opts?.onPathChosen?.();
  await invokeExportPlaylist(rustSegments, outputPath, watermark, vertical, opts);
  return outputPath;
}

/**
 * Success feedback for "Save to computer" exports: a toast naming the file
 * with a jump straight to it in Finder/Explorer.
 */
export function notifyExportSuccess(outputPath: string): void {
  const fileName = outputPath.split(/[/\\]/).pop() ?? outputPath;
  toast.success("Video exported", {
    description: fileName,
    action: {
      label: "Show in folder",
      onClick: () => {
        revealItemInDir(outputPath).catch(() => {});
      },
    },
  });
}
