/**
 * What a clip in the desktop's scouting report plays, and from where.
 */

import type { PlaylistClipItem, SyncPoint } from "../types/match";
import type { DrawingShape } from "./clip-drawing";
import { clipBounds, computeVideoTime } from "./clip-timing";
import { clipWatchEffects, type WatchDrawing, type WatchSlow } from "./watch-queue";

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

/** A report clip's drawings and slow motion, in the time of what it plays. */
export interface ReportClipEffects {
  drawings: WatchDrawing[];
  slows: WatchSlow[];
}

/** Closer than this to a clip's ends a drawing isn't shown, as in the editor and the export (clip-timeline's segmentTimeline). */
const EDGE_SECONDS = 0.1;
/** The shortest stretch of a slow section worth playing. */
const MIN_SLOW_SECONDS = 0.1;

/**
 * What a report clip's player freezes on and slows down, in its source's
 * time: the game's own video keeps the editor's absolute times, inside the
 * clip's window (a drawing at its very ends is left out, a section is cut to
 * it); the uploaded copy takes the players' rebase onto the file
 * (clipWatchEffects). Nothing to play, nothing to show.
 */
export function reportClipEffects(item: Pick<PlaylistClipItem, "drawings" | "slowMotion">, source: ReportClipSource): ReportClipEffects {
  if (source.kind === "none") return { drawings: [], slows: [] };
  if (source.kind === "shared") {
    const fx = clipWatchEffects(item, source.url);
    return { drawings: fx.drawings ?? [], slows: fx.slowMotion ?? [] };
  }
  return clipEffectsInWindow(item, source.start, source.end);
}

/**
 * A clip's effects inside its window [start, end] of the game's video, in that
 * video's own (absolute) time, as the editor and the export take them: a
 * drawing at the window's very ends is left out, a section is cut to it.
 */
export function clipEffectsInWindow(item: Pick<PlaylistClipItem, "drawings" | "slowMotion">, start: number, end: number): ReportClipEffects {
  const drawings = (item.drawings ?? [])
    .filter((d) => d.t > start + EDGE_SECONDS && d.t < end - EDGE_SECONDS)
    .sort((a, b) => a.t - b.t)
    .map((d) => ({ id: d.id, at: d.t, hold: d.hold, shapes: d.shapes }));
  const slows = (item.slowMotion ?? [])
    .map((s) => {
      const at = Math.max(s.t, start);
      return { id: s.id, at, length: Math.min(s.t + s.length, end) - at, rate: s.rate };
    })
    .filter((s) => s.length >= MIN_SLOW_SECONDS)
    .sort((a, b) => a.at - b.at);
  return { drawings, slows };
}

/**
 * How far into a clip its still is taken: just past an uploaded copy's
 * quarter-second fade-in from black, the clip's first frame worth showing.
 */
export const FIRST_FRAME_SECONDS = 0.3;

/** Where a report tile's still comes from: the game's own video, or the clip's uploaded copy. */
export type ReportFrameRequest = { kind: "local"; path: string; at: number } | { kind: "shared"; url: string; at: number };

const ms = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The still a report tile shows until it plays: the clip's first frame, from
 * what the tile would play (the game's video at the clip's start, or the
 * uploaded copy just past its fade-in). A window too short for the offset
 * gives its middle. Null when nothing can play.
 */
export function reportFirstFrame(source: ReportClipSource): ReportFrameRequest | null {
  switch (source.kind) {
    case "local": {
      const at = source.end - source.start < 2 * FIRST_FRAME_SECONDS ? (source.start + source.end) / 2 : source.start + FIRST_FRAME_SECONDS;
      return { kind: "local", path: source.path, at: ms(at) };
    }
    case "shared":
      return { kind: "shared", url: source.url, at: FIRST_FRAME_SECONDS };
    case "none":
      return null;
  }
}

/** A still's cache key: a trim, a sync change or a new upload makes a new one. */
export function reportFrameKey(request: ReportFrameRequest): string {
  return request.kind === "local" ? `local|${request.path}|${request.at.toFixed(3)}` : `shared|${request.url}|${request.at.toFixed(3)}`;
}

/**
 * The drawing a published clip's poster burns in: the first one its uploaded
 * file shows (the players' rule over the file's own window, clipWatchEffects),
 * at the exact frame the coach drew on. Taken from the file, never from
 * today's pre- and post-roll, so the poster and the PDF never show a drawing
 * the clip doesn't. Null when the file shows none.
 */
export function reportPosterDrawing(item: Pick<PlaylistClipItem, "drawings" | "r2Url">): { t: number; shapes: DrawingShape[] } | null {
  if (!item.r2Url) return null;
  const first = clipWatchEffects(item, item.r2Url).drawings?.[0];
  const drawing = first ? item.drawings?.find((d) => d.id === first.id) : undefined;
  return drawing ? { t: drawing.t, shapes: drawing.shapes } : null;
}
