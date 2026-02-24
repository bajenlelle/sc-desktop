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

export async function exportPlaylist(
  videoUrl: string,
  events: PlayByPlayEvent[],
  syncPoint: SyncPoint,
  preRoll: number,
  postRoll: number,
  playlistName: string,
): Promise<void> {
  if (!isLocalPath(videoUrl)) throw new Error("Export requires a local video file.");

  const clips = events
    .map((e) => {
      const t = computeVideoTime(e, syncPoint);
      if (t === null) return null;
      return { start: Math.max(0, t - preRoll), end: t + postRoll };
    })
    .filter((c): c is { start: number; end: number } => c !== null);

  if (clips.length === 0) throw new Error("No clips with valid video times.");

  const outputPath = await save({
    defaultPath: `${playlistName.replace(/[^a-z0-9]/gi, "_")}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
  });
  if (!outputPath) return; // user cancelled

  await invoke<void>("export_playlist", {
    videoPath: videoUrl,
    clips,
    outputPath,
  });
}
