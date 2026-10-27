/**
 * What a clip in the desktop's scouting report plays, and from where.
 */

import type { PlaylistClipItem, SyncPoint } from "../types/match";
import { clipBounds, computeVideoTime } from "./clip-timing";

export type ReportClipSource =
  /** The game's video on this computer, from `start` to `end` (seconds into the file). */
  | { kind: "local"; path: string; start: number; end: number }
  /** The clip's uploaded copy, played from its start to its end. */
  | { kind: "shared"; url: string }
  /** Nothing to play: the game's video isn't on this computer, or the game isn't synced to it. */
  | { kind: "none"; reason: "no_video" | "no_sync" };

/**
 * Where a report clip plays from, in this order:
 *
 * 1. The game's own video, when it is on this computer and the play can be
 *    placed in it (the game is synced and the play has a time). The window is
 *    the one exports and uploaded copies are cut with (`clipBounds`), so the
 *    preview shows what goes out.
 * 2. The clip's uploaded copy. `r2Url` is cleared whenever the clip's trim
 *    changes, so one that is there is the current cut.
 * 3. Neither: why not. A missing video comes first; a video that is here but
 *    can't be placed means the game isn't synced.
 *
 * `videoPath` is the game's local file when it is present on this computer,
 * else null.
 */
export function reportClipSource(args: {
  item: Pick<PlaylistClipItem, "preRollOffset" | "postRollOffset" | "r2Url">;
  event: { realWorldTime?: string | null };
  videoPath: string | null;
  syncPoint: SyncPoint | null;
  preRoll: number;
  postRoll: number;
}): ReportClipSource {
  const { item, event, videoPath, syncPoint, preRoll, postRoll } = args;
  const videoTime = syncPoint ? computeVideoTime(event, syncPoint) : null;
  if (videoPath && videoTime !== null) {
    const { start, end } = clipBounds(videoTime, preRoll, postRoll, item.preRollOffset, item.postRollOffset);
    return { kind: "local", path: videoPath, start, end };
  }
  if (item.r2Url) return { kind: "shared", url: item.r2Url };
  return { kind: "none", reason: videoPath ? "no_sync" : "no_video" };
}
