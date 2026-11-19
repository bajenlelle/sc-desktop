/**
 * Clips players don't have yet (no uploaded file), as the game view's
 * background send sees them: which files a send put up, and which clips no
 * send can cut here and why, so a send never "succeeds" while leaving clips
 * behind in silence. Pure; `use-collect.ts` uses it.
 */
import { isClipItem, type PlaylistItem } from "../types/match";

type Uploaded = { matchId: string; eventId: number; r2Url: string };

/** The items with the files a send put up; the same array when none of them is here. */
export function withUploadedFiles(items: PlaylistItem[], uploaded: readonly Uploaded[]): PlaylistItem[] {
  const byKey = new Map(uploaded.map((u) => [`${u.matchId}:${u.eventId}`, u.r2Url]));
  let changed = false;
  const out = items.map((i) => {
    if (!isClipItem(i)) return i;
    const url = byKey.get(`${i.matchId}:${i.eventId}`);
    if (url === undefined || url === i.r2Url) return i;
    changed = true;
    return { ...i, r2Url: url };
  });
  return changed ? out : items;
}

export type UnsendableReason = "sync" | "video" | "play";

/**
 * The clips with no file that can't be cut on this computer, the way the cut
 * decides it (`buildShipSegments`): no sync for their game, no video path
 * (or the game wasn't read), or no play. One reason, the one the coach can
 * act on first: sync, then video, then the play.
 */
export function unsendableClips(
  items: readonly PlaylistItem[],
  games: ReadonlyMap<string, { videoUrl?: string; syncPoint?: unknown }>,
  hasPlay: (key: string) => boolean,
): { count: number; reason: UnsendableReason | null } {
  let count = 0;
  const reasons = new Set<UnsendableReason>();
  for (const i of items) {
    if (!isClipItem(i) || i.r2Url) continue;
    const game = games.get(i.matchId);
    const reason: UnsendableReason | null = !game?.videoUrl
      ? game && !game.syncPoint ? "sync" : "video"
      : !game.syncPoint
        ? "sync"
        : hasPlay(`${i.matchId}:${i.eventId}`)
          ? null
          : "play";
    if (reason) {
      count++;
      reasons.add(reason);
    }
  }
  const reason = reasons.has("sync") ? "sync" : reasons.has("video") ? "video" : reasons.has("play") ? "play" : null;
  return { count, reason };
}
