import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isLocalPath } from "@/lib/stream";
import type { PlayByPlayEvent, SyncPoint } from "@/types/match";

function computeVideoTime(event: PlayByPlayEvent, sync: SyncPoint): number | null {
  if (!event.realWorldTime || !sync.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(sync.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return sync.syncVideoTime + (eventMs - syncMs) / 1000;
}

export type ExportSegment =
  | { kind: 'clip'; videoPath: string; matchId: string; event: PlayByPlayEvent; syncPoint: SyncPoint; preRollOffset?: number; postRollOffset?: number }
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
  | { kind: 'clip'; video_path: string; start: number; end: number }
  | { kind: 'text'; text: string; duration_seconds: number };

function buildRustSegments(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
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
      return {
        kind: 'clip',
        video_path: seg.videoPath,
        start: Math.max(0, t - preRoll - (seg.preRollOffset ?? 0)),
        end: t + postRoll + (seg.postRollOffset ?? 0),
      };
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
): Promise<void> {
  const rustSegments = buildRustSegments(segments, preRoll, postRoll);
  await invoke<void>("export_playlist", { segments: rustSegments, outputPath });
}

/**
 * Returns true when a file was actually written — a cancelled save dialog
 * resolves false so callers don't record the export as having happened.
 */
export async function exportPlaylist(
  segments: ExportSegment[],
  preRoll: number,
  postRoll: number,
  playlistName: string,
): Promise<boolean> {
  const rustSegments = buildRustSegments(segments, preRoll, postRoll);

  const outputPath = await save({
    defaultPath: `${playlistName.replace(/[^a-z0-9]/gi, "_")}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
  });
  if (!outputPath) return false; // user cancelled

  await invoke<void>("export_playlist", { segments: rustSegments, outputPath });
  return true;
}
