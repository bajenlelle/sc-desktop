/**
 * The content key of a server export, worked out on the client exactly as
 * the desktop works it out for "Send to my phone": highlightContentKey over
 * the segments that render, with the playlist's clip length. The desktop
 * builds those segments in pages/playlists.tsx (buildExportSegments: plays
 * the game's data still has, from games with a video and a sync) and trims
 * them in lib/export.ts (dropClipsOutsideVideos: a clip that starts in the
 * last quarter second of its video, or after it, is left out). Here the
 * video is the game's cloud copy: `syncByMatch` holds the games whose ready
 * copy has a sync, `copyDurationByMatch` their copies' lengths.
 *
 * The `game-video` function can't bundle the card code the key reads, so
 * the web sends this key with a share; the same rows give the same key on
 * either side, and a link made on one is found again from the other.
 *
 * Like the desktop, a clip whose play the sync can't place (no time) stays
 * in the key though the renderer skips it.
 */
import { clipBounds, computeVideoTime, playlistRolls } from "./clip-timing";
import type { ExportDropped } from "./game-video-wire";
import { highlightContentKey, type HighlightAspect, type HighlightContentSegment } from "./highlight-shares-db";
import { itemKey } from "./playlist-edits";
import { isClipItem, type PlayByPlayEvent, type Playlist, type SyncPoint } from "../types/match";

/** A clip starting this close to its video's end has no footage beyond its own fade (the desktop's epsilon). */
const PAST_END_SECONDS = 0.25;

export interface ExportContentInput {
  playlist: Pick<Playlist, "items" | "preRoll" | "postRoll">;
  /** Plays by `<matchId>:<eventId>`; a clip whose play is missing renders nothing. */
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  /** The sync that places each game's plays in its ready copy; a game without one renders none of its clips. */
  syncByMatch: ReadonlyMap<string, SyncPoint>;
  /** Each copy's length in seconds (game_videos.duration_seconds); a game missing here keeps every clip. */
  copyDurationByMatch: ReadonlyMap<string, number | null | undefined>;
  aspect: HighlightAspect;
  /** Item keys to export instead of the whole playlist; the playlist's order is kept. */
  selection?: ReadonlySet<string> | readonly string[] | null;
}

export interface ExportContent {
  /** highlightContentKey of what renders. */
  key: string;
  /** Clips that render (a play without a time included, as the desktop counts it). */
  clips: number;
  cards: number;
  /** 9:16 only: rendered clips that carry a pan (the rest are centred); 0 for 16:9. */
  pannedClips: number;
  /** Clips left out because they start past the end of their copy. */
  dropped: ExportDropped[];
}

export function exportContentKey({
  playlist,
  eventByKey,
  syncByMatch,
  copyDurationByMatch,
  aspect,
  selection,
}: ExportContentInput): ExportContent {
  const rolls = playlistRolls(playlist);
  const chosen = selection ? new Set(selection) : null;
  const segments: HighlightContentSegment[] = [];
  const dropped: ExportDropped[] = [];
  let clips = 0;
  let cards = 0;
  let pannedClips = 0;

  for (const item of playlist.items) {
    const key = itemKey(item);
    if (chosen && !chosen.has(key)) continue;
    if (!isClipItem(item)) {
      segments.push({ kind: "text", text: item.text, durationSeconds: item.durationSeconds, ...(item.card ? { card: item.card } : {}) });
      cards++;
      continue;
    }
    const event = eventByKey.get(key);
    const syncPoint = syncByMatch.get(item.matchId);
    if (!event || !syncPoint) continue;

    const duration = copyDurationByMatch.get(item.matchId);
    const t = computeVideoTime(event, syncPoint);
    if (typeof duration === "number" && Number.isFinite(duration) && t !== null) {
      const { start } = clipBounds(t, rolls.pre, rolls.post, item.preRollOffset, item.postRollOffset);
      if (!(start < duration - PAST_END_SECONDS)) {
        dropped.push({ matchId: item.matchId, eventId: item.eventId, reason: "past_end" });
        continue;
      }
    }

    segments.push({
      kind: "clip",
      matchId: item.matchId,
      event,
      syncPoint,
      ...(item.preRollOffset !== undefined ? { preRollOffset: item.preRollOffset } : {}),
      ...(item.postRollOffset !== undefined ? { postRollOffset: item.postRollOffset } : {}),
      ...(item.cropKeyframes ? { cropKeyframes: item.cropKeyframes } : {}),
    });
    clips++;
    if (aspect === "9:16" && (item.cropKeyframes?.length ?? 0) > 0) pannedClips++;
  }

  return { key: highlightContentKey(segments, rolls.pre, rolls.post, aspect), clips, cards, pannedClips, dropped };
}
