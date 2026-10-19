/**
 * The list's rows: every playlist item in order, each with its play (when
 * the game's data has it), the watch item the queue plays for it, and why
 * it can't play when it can't. Pure, so the shell computes it once per
 * change and the rows only draw.
 */
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import type { WatchItem } from "@scoutable/shared/lib/watch-queue";
import { isClipItem, type PlayByPlayEvent, type Playlist, type PlaylistItem, type StoredMatch } from "@scoutable/shared/types/match";
import type { EditorCloud } from "./use-playlist-editor";

export type RowAvailability =
  | "ready"
  /** The game's plays haven't arrived yet. */
  | "loading"
  /** The play is no longer in the game's data. */
  | "no-event"
  /** The game has no cloud copy: nothing to play from, nothing to cut. */
  | "no-copy"
  | "uploading"
  | "converting"
  | "failed"
  /** The copy is ready but the game has no sync point yet. */
  | "no-sync"
  /** The sync can't place this play (its time is missing). */
  | "no-time";

export interface EditorRow {
  key: string;
  item: PlaylistItem;
  event: PlayByPlayEvent | null;
  /** What the queue plays for this row; null when it can't play. */
  watch: WatchItem | null;
  availability: RowAvailability;
  /** The game's title, for multi-game playlists. */
  matchTitle?: string;
}

export function buildEditorRows({
  playlist,
  eventByKey,
  watchItems,
  cloud,
  matches,
  eventsLoaded,
}: {
  playlist: Playlist;
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  watchItems: readonly WatchItem[];
  cloud: EditorCloud;
  matches: ReadonlyMap<string, StoredMatch>;
  eventsLoaded: ReadonlySet<string>;
}): EditorRow[] {
  const watchByKey = new Map(watchItems.map((w) => [w.key, w]));
  return playlist.items.map((item): EditorRow => {
    const key = itemKey(item);
    const watch = watchByKey.get(key) ?? null;
    if (!isClipItem(item)) return { key, item, event: null, watch, availability: "ready" };
    const event = eventByKey.get(key) ?? null;
    const matchTitle = matches.get(item.matchId)?.title;
    if (!event) {
      return { key, item, event, watch, availability: eventsLoaded.has(item.matchId) ? "no-event" : "loading", matchTitle };
    }
    if (watch) return { key, item, event, watch, availability: "ready", matchTitle };
    let availability: RowAvailability = "no-copy";
    const video = cloud.videoByMatch.get(item.matchId);
    if (video?.status === "uploading") availability = "uploading";
    else if (video?.status === "converting") availability = "converting";
    else if (video?.status === "failed") availability = "failed";
    else if (video?.status === "ready") {
      const sync = cloud.syncByMatch.get(item.matchId);
      availability = !sync ? "no-sync" : computeVideoTime(event, sync) === null ? "no-time" : "no-copy";
    } else if (!cloud.loaded) availability = "loading";
    return { key, item, event, watch, availability, matchTitle };
  });
}

/** What a row that can't play says, and where the fix is. */
export function availabilityNotice(
  availability: RowAvailability,
  matchId: string,
): { text: string; action?: { label: string; href: string } } | null {
  const library = `/library/${encodeURIComponent(matchId)}`;
  switch (availability) {
    case "ready":
      return null;
    case "loading":
      return { text: "Loading…" };
    case "no-event":
      return { text: "This play is no longer in the game's data" };
    case "no-copy":
      return { text: "No cloud copy", action: { label: "Upload the video", href: library } };
    case "uploading":
      return { text: "Uploading the video…", action: { label: "Open game", href: library } };
    case "converting":
      return { text: "Converting the video…", action: { label: "Open game", href: library } };
    case "failed":
      return { text: "The video couldn't be converted", action: { label: "Open game", href: library } };
    case "no-sync":
      return { text: "Set the tip-off to play this clip", action: { label: "Open game", href: library } };
    case "no-time":
      return { text: "This play can't be placed in the video" };
  }
}
