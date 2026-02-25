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

export interface ExportItem {
  videoPath: string;
  event: PlayByPlayEvent;
  syncPoint: SyncPoint;
  preRollOffset?: number;
  postRollOffset?: number;
}

export async function exportPlaylist(
  items: ExportItem[],
  preRoll: number,
  postRoll: number,
  playlistName: string,
): Promise<void> {
  for (const item of items) {
    if (!isLocalPath(item.videoPath))
      throw new Error("Export requires a local video file for every session.");
  }

  const clips = items
    .map((item) => {
      const t = computeVideoTime(item.event, item.syncPoint);
      if (t === null) return null;
      return {
        video_path: item.videoPath,
        start: Math.max(0, t - preRoll - (item.preRollOffset ?? 0)),
        end: t + postRoll + (item.postRollOffset ?? 0),
      };
    })
    .filter((c): c is { video_path: string; start: number; end: number } => c !== null);

  if (clips.length === 0) throw new Error("No clips with valid video times.");

  const outputPath = await save({
    defaultPath: `${playlistName.replace(/[^a-z0-9]/gi, "_")}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
  });
  if (!outputPath) return; // user cancelled

  await invoke<void>("export_playlist", { clips, outputPath });
}
