import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { isLocalPath } from "@/lib/stream";
import { probeVideoDuration, probeVideoPath, videoBasename } from "@/lib/video-probe";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { toSegmentKeyframes, type CropKeyframe } from "@scoutable/shared/lib/crop-path";
import type { PlayByPlayEvent, SyncPoint } from "@/types/match";

export type ExportSegment =
  | { kind: 'clip'; videoPath: string; matchId: string; event: PlayByPlayEvent; syncPoint: SyncPoint; preRollOffset?: number; postRollOffset?: number; cropKeyframes?: CropKeyframe[] }
  | { kind: 'text'; text: string; durationSeconds: number };

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
  | { kind: 'text'; text: string; duration_seconds: number };

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
      `The video file for "${videoBasename(gone)}" isn't on this computer — open the game in the Library and locate it.`,
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

function buildRustSegments(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  vertical: boolean,
): RustSegment[] {
  for (const seg of segments) {
    if (seg.kind === 'clip' && !isLocalPath(seg.videoPath))
      throw new Error("Export requires a local video file for every session.");
  }

  const rustSegments: RustSegment[] = segments
    .map((seg): RustSegment | null => {
      if (seg.kind === 'text') {
        return { kind: 'text', text: seg.text, duration_seconds: seg.durationSeconds };
      }
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
): Promise<void> {
  await assertVideosPresent(segments);
  const rustSegments = buildRustSegments(segments, preRoll, postRoll, vertical);
  await assertClipsWithinVideos(rustSegments);
  await invoke<void>("export_playlist", { segments: rustSegments, outputPath, watermark, vertical });
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
  const rustSegments = buildRustSegments(kept, preRoll, postRoll, vertical);
  await assertClipsWithinVideos(rustSegments);

  const outputPath = await save({
    defaultPath: `${playlistName.replace(/[^a-z0-9]/gi, "_")}${vertical ? "_vertical" : ""}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
  });
  if (!outputPath) return null; // user cancelled

  await invoke<void>("export_playlist", { segments: rustSegments, outputPath, watermark, vertical });
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
