/**
 * The server export's plan: the segments one MP4 of a playlist (or of a
 * selection of its items) is made of, in playlist order, as the `game-video`
 * function computes it from the rows: once at `export` (the preview the
 * editor gets back) and again at `render_take` (what the renderer cuts), so
 * edits made while the job waited are in. Plus a fingerprint of that plan:
 * the function keeps the client's content key on a new highlight link only
 * when the plan it rendered is the plan it previewed.
 *
 * The function imports this file by relative path, so it has NO runtime
 * imports: Deno needs a `.ts` extension on a relative import, and this
 * package's tsc refuses one on a value import (type-only imports may carry
 * it). The function computes each clip's window with clip-ship-plan.ts's
 * computeVideoTime / clipBounds / playlistRolls, exactly as the ship plan
 * does, and hands it in; the two small rules this file needs besides are
 * restated here, each pinned to its source by export-plan.test.ts:
 * game-video-wire.ts's exportFrameRate and crop-path.ts's toSegmentKeyframes.
 */
import type { ExportAspect, ExportDropped, RenderExportSegment, ShipNoCopy } from "./game-video-wire.ts";

/** A clip "starting" in its copy's final quarter-second has no footage beyond its own fade (the desktop's dropClipsOutsideVideos). */
export const PAST_END_EPSILON_SECONDS = 0.25;
/** A card's length when its row has none (playlists-db's rowToPlaylist reads the same default). */
export const DEFAULT_CARD_SECONDS = 5;
/** A card is held to this range, whatever its row says: ffmpeg's fades need a real length. */
export const MIN_CARD_SECONDS = 1;
export const MAX_CARD_SECONDS = 60;

/** One playlist item as the rows hold it, in playlist order. */
export type ExportPlanItem =
  | {
      kind: "clip";
      matchId: string;
      eventId: number;
      /**
       * The clip's window in its game's video, from clip-ship-plan's
       * clipBounds(computeVideoTime(event, sync), pair.pre, pair.post,
       * offsets); null when the play can't be placed (no sync, no time).
       */
      window: { start: number; end: number } | null;
      /** playlist_clips.crop_keyframes as stored (absolute video seconds, crop-path's model); anything else is no pan. */
      cropKeyframes: unknown;
    }
  | {
      kind: "card";
      /** playlist_clips.item_id: the card's item key is `text:<id>`. */
      id: string;
      text: string;
      /** playlist_clips.duration_seconds; null or nonsense gets DEFAULT_CARD_SECONDS. */
      durationSeconds: number | null;
      /** playlist_clips.card: a stats card's spec, passed through to the renderer; null for a text card. */
      card: unknown | null;
    };

/** A game's cloud copy the owner may export from: its ready game_videos row. */
export interface ExportPlanCopy {
  videoId: string;
  /** game_videos.duration_seconds; null when unknown (its clips are kept, as the desktop keeps them). */
  durationSeconds: number | null;
  /** game_videos.fps; null when the copy's rate wasn't recorded (desktop copies), which renders at 30. */
  fps: number | null;
}

export interface ExportPlanInput {
  aspect: ExportAspect;
  /** Every item of the playlist, in its order. */
  items: readonly ExportPlanItem[];
  /** Item keys (exportItemKey) to export instead of the whole playlist; null for all of it. Playlist order is kept. */
  selection: readonly string[] | null;
  /** The copy the owner may use, by match id; a game missing here has none (reported in noCopy). */
  copies: ReadonlyMap<string, ExportPlanCopy>;
}

export interface ExportPlanSegments {
  segments: RenderExportSegment[];
  /** exportFrameRate of the first clip's copy: every segment and the final pass use it; "" when its row has no frame rate (the renderer probes it). */
  rate: string;
  clips: number;
  cards: number;
  /** Clips whose game has no copy the owner may use, by game. */
  noCopy: ShipNoCopy[];
  /** Clips the copies can't play: no time for the play, or a start past the copy's end. */
  dropped: ExportDropped[];
}

/** The key an item goes by in the editor and in a selection: `<matchId>:<eventId>`, or `text:<id>` for a card (playlist-edits' itemKey). */
export function exportItemKey(item: ExportPlanItem): string {
  return item.kind === "clip" ? `${item.matchId}:${item.eventId}` : `text:${item.id}`;
}

/**
 * The segments of the export, in playlist order: the selected items (all of
 * them without a selection); a clip whose play has no time is dropped
 * (`no_time`), one whose game has no copy the owner may use is reported in
 * noCopy, one that starts in its copy's last quarter-second or after it is
 * dropped (`past_end`), and a window running past the copy's end is cut at
 * the end (ffmpeg stops there anyway, and the fade-out then lands on real
 * footage). Cards keep their text and spec. A 9:16 clip carries its pan
 * rebased onto the clip (toSegmentKeyframes, as the desktop's export does);
 * a 16:9 clip none.
 */
export function buildExportPlanSegments(input: ExportPlanInput): ExportPlanSegments {
  const selected = input.selection ? new Set(input.selection) : null;
  const segments: RenderExportSegment[] = [];
  const dropped: ExportDropped[] = [];
  const noCopyByMatch = new Map<string, ShipNoCopy>();
  let firstFps: number | null | undefined;

  for (const item of input.items) {
    if (selected && !selected.has(exportItemKey(item))) continue;
    if (item.kind === "card") {
      segments.push({ kind: "card", durationSeconds: cardSeconds(item.durationSeconds), text: item.text, card: item.card ?? null });
      continue;
    }
    const { matchId, eventId } = item;
    const window = validWindow(item.window);
    if (!window) {
      dropped.push({ matchId, eventId, reason: "no_time" });
      continue;
    }
    const copy = input.copies.get(matchId);
    if (!copy) {
      const entry = noCopyByMatch.get(matchId) ?? { matchId, eventIds: [] };
      entry.eventIds.push(eventId);
      noCopyByMatch.set(matchId, entry);
      continue;
    }
    const duration = typeof copy.durationSeconds === "number" && Number.isFinite(copy.durationSeconds) ? copy.durationSeconds : null;
    if (duration !== null && window.start >= duration - PAST_END_EPSILON_SECONDS) {
      dropped.push({ matchId, eventId, reason: "past_end" });
      continue;
    }
    const start = window.start;
    const end = duration !== null ? Math.min(window.end, duration) : window.end;
    if (firstFps === undefined) firstFps = copy.fps;
    segments.push({
      kind: "clip",
      matchId,
      eventId,
      videoId: copy.videoId,
      start,
      end,
      keyframes: input.aspect === "9:16" ? toSegmentKeyframes(cropKeyframesOf(item.cropKeyframes), start, end) : null,
    });
  }

  const clips = segments.filter((s) => s.kind === "clip").length;
  return {
    segments,
    // A copy the desktop uploaded has no frame rate on its row: "" lets the
    // renderer take it from its probe of that copy instead of guessing 30.
    rate: typeof firstFps === "number" && Number.isFinite(firstFps) && firstFps > 0 ? exportFrameRate(firstFps) : "",
    clips,
    cards: segments.length - clips,
    noCopy: [...noCopyByMatch.values()],
    dropped,
  };
}

function validWindow(w: { start: number; end: number } | null): { start: number; end: number } | null {
  if (!w || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end <= w.start) return null;
  return w;
}

function cardSeconds(v: number | null): number {
  const d = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_CARD_SECONDS;
  return Math.min(MAX_CARD_SECONDS, Math.max(MIN_CARD_SECONDS, d));
}

/** A stored pan (playlist_clips.crop_keyframes jsonb): its well-formed keyframes, or undefined for none. */
export function cropKeyframesOf(raw: unknown): { t: number; cx: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { t: number; cx: number }[] = [];
  for (const k of raw) {
    const t = (k as { t?: unknown } | null)?.t;
    const cx = (k as { cx?: unknown } | null)?.cx;
    if (typeof t === "number" && Number.isFinite(t) && typeof cx === "number" && Number.isFinite(cx)) out.push({ t, cx });
  }
  return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// The fingerprint
// ---------------------------------------------------------------------------

/** What the fingerprint covers: everything that shapes the rendered file. */
export interface ExportPlanShape {
  aspect: ExportAspect;
  watermark: boolean;
  rate: string;
  segments: readonly RenderExportSegment[];
}

/**
 * A stable fingerprint of what an export renders: each segment in order (a
 * clip's game, play, copy, window and pan; a card's length, text and spec),
 * the aspect, the frame rate and the wordmark. Times are compared at the
 * millisecond, pans at four decimals, a spec by its canonical JSON (keys
 * sorted). Not the client's content key (highlightContentKey, which needs
 * the card code): it only tells the function whether the plan it rendered
 * at render_take is the one it previewed at `export`.
 */
export function exportPlanFingerprint(plan: ExportPlanShape): string {
  const parts = plan.segments.map((s) =>
    s.kind === "card"
      ? `k|${ms(s.durationSeconds)}|${JSON.stringify(s.text)}|${canonicalJson(s.card ?? null)}`
      : `c|${s.matchId}|${s.eventId}|${s.videoId}|${ms(s.start)}|${ms(s.end)}|${(s.keyframes ?? []).map((k) => `${ms(k.t)}:${k.cx.toFixed(4)}`).join(",")}`,
  );
  return `ep1-${cyrb53(`ep1|${plan.aspect}|${plan.watermark ? "w" : "-"}|${plan.rate}|${parts.join(";")}`)}`;
}

function ms(seconds: number): string {
  return Number.isFinite(seconds) ? seconds.toFixed(3) : "x";
}

/** JSON with object keys sorted at every level, so one spec always reads the same. */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** cyrb53: a small, fast, deterministic 53-bit string hash (public domain), as highlight-shares-db.ts uses. */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------------------------------------------------------------------------
// Restated so this file stays import-free (export-plan.test.ts pins both)
// ---------------------------------------------------------------------------

/** game-video-wire.ts's exportFrameRate (the desktop's export_frame_rate), verbatim. */
export function exportFrameRate(fps: number | null | undefined): string {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) return "30";
  for (const [ntsc, exact] of [
    [23.976, "24000/1001"],
    [29.97, "30000/1001"],
    [59.94, "60000/1001"],
  ] as const) {
    if (Math.abs(fps - ntsc) < 0.01) return exact;
  }
  return String(Math.min(60, Math.max(1, Math.round(fps))));
}

interface Keyframe {
  t: number;
  cx: number;
}

const DEFAULT_CX = 0.5;

function sortedKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.t - b.t);
}

/** crop-path.ts's cxAt, verbatim. */
function cxAt(keyframes: Keyframe[] | undefined, t: number): number {
  if (!keyframes || keyframes.length === 0) return DEFAULT_CX;
  const kfs = sortedKeyframes(keyframes);
  if (t <= kfs[0].t) return kfs[0].cx;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.cx;
  for (let i = 1; i < kfs.length; i++) {
    if (t <= kfs[i].t) {
      const a = kfs[i - 1];
      const b = kfs[i];
      const span = b.t - a.t;
      if (span <= 0) return b.cx;
      return a.cx + ((b.cx - a.cx) * (t - a.t)) / span;
    }
  }
  return last.cx;
}

/** crop-path.ts's toSegmentKeyframes, verbatim: absolute-time keyframes rebased onto a clip window. */
export function toSegmentKeyframes(keyframes: Keyframe[] | undefined, clipStart: number, clipEnd: number): Keyframe[] {
  if (!keyframes || keyframes.length === 0) return [{ t: 0, cx: DEFAULT_CX }];
  const duration = Math.max(0, clipEnd - clipStart);
  const inside = sortedKeyframes(keyframes).filter((k) => k.t > clipStart && k.t < clipEnd);
  const result: Keyframe[] = [
    { t: 0, cx: cxAt(keyframes, clipStart) },
    ...inside.map((k) => ({ t: k.t - clipStart, cx: k.cx })),
    { t: duration, cx: cxAt(keyframes, clipEnd) },
  ];
  const deduped: Keyframe[] = [];
  for (const k of result) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.t - k.t) < 0.001) {
      deduped[deduped.length - 1] = k;
    } else {
      deduped.push(k);
    }
  }
  return deduped;
}
