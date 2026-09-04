import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { isLocalPath } from "@/lib/stream";
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
 */
export async function exportPlaylistToPath(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  outputPath: string,
  watermark: boolean,
  vertical = false,
): Promise<void> {
  const rustSegments = buildRustSegments(segments, preRoll, postRoll, vertical);
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
  const rustSegments = buildRustSegments(segments, preRoll, postRoll, vertical);

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
