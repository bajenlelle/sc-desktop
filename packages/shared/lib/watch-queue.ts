/**
 * What a recipient watches when they open a shared playlist, and how their
 * progress through it is counted. Pure, so the web watch view's rules are
 * tested here: which items make the list, where Resume starts, what counts
 * as watched, and that a clip is recorded as watched once.
 *
 * Clips are identified by game and event together: event ids number the
 * plays within one game, so two games in one playlist can share them.
 */
import type { Playlist, PlayByPlayEvent, PlaylistClipItem, PlaylistTextCard, StoredMatch } from "../types/match";
import type { DrawingShape } from "./clip-drawing";
import type { SlowRate } from "./clip-timeline";
import { shippedStart, shippedTotals } from "./clip-timing";
import { isClipItem } from "../types/match";
import type { OrgMembership } from "../types/org";
import { clipViewKey } from "./clip-views-db";
import { isStaffRole } from "./orgs";
import { playableClips } from "./playlist-feed";

/** A drawing in the clip's uploaded file: `at` is seconds into the file. */
export interface WatchDrawing {
  id: string;
  at: number;
  hold: number;
  shapes: DrawingShape[];
}

/** A slow-motion section in the clip's uploaded file. */
export interface WatchSlow {
  id: string;
  at: number;
  length: number;
  rate: SlowRate;
}

/** One item a recipient can watch: a clip's own uploaded file, or a timed text card. */
export type WatchItem =
  | {
      kind: "clip";
      key: string;
      event: PlayByPlayEvent;
      matchId: string;
      r2Url: string;
      note?: string;
      drawings?: WatchDrawing[];
      slowMotion?: WatchSlow[];
    }
  | { kind: "text"; key: string; card: PlaylistTextCard };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A clip's drawings and slow motion in its uploaded file's time: the file
 * starts at the clip's cut, which its key records (to a tenth of a second,
 * so a frozen frame can be a frame off the editor's). A key without a start
 * (older uploads) carries neither. Drawings outside the file (its first
 * and last tenth included) are dropped and sections are cut to it; its end
 * is its key's pre + post totals.
 */
export function clipWatchEffects(
  clip: Pick<PlaylistClipItem, "drawings" | "slowMotion">,
  r2Url: string,
): { drawings?: WatchDrawing[]; slowMotion?: WatchSlow[] } {
  const start = shippedStart(r2Url);
  if (start === null) return {};
  // The file runs at most its key's pre + post totals (less only when the play
  // was too early in the video for the whole pre-roll).
  const totals = shippedTotals(r2Url);
  const end = totals ? totals.pre + totals.post : Infinity;
  const drawings = (clip.drawings ?? [])
    .map((d) => ({ id: d.id, at: r3(d.t - start), hold: d.hold, shapes: d.shapes }))
    .filter((d) => d.at >= 0.1 && d.at < end - 0.1)
    .sort((a, b) => a.at - b.at);
  const slowMotion = (clip.slowMotion ?? [])
    .map((s) => {
      const at = Math.max(0, s.t - start);
      return { id: s.id, at: r3(at), length: r3(Math.min(s.t + s.length - start, end) - at), rate: s.rate };
    })
    .filter((s) => s.length >= 0.1)
    .sort((a, b) => a.at - b.at);
  return { ...(drawings.length ? { drawings } : {}), ...(slowMotion.length ? { slowMotion } : {}) };
}

/** The key a clip goes by in the watch list. */
export function clipKey(matchId: string, eventId: number): string {
  return `${matchId}:${eventId}`;
}

/**
 * The playlist's items in order, as the recipient sees them. Clips that are
 * not uploaded yet are left out (a row they can never play only reads as
 * broken), and so are clips whose play the game data no longer has.
 */
export function buildWatchItems(playlist: Playlist, eventByKey: Map<string, PlayByPlayEvent>): WatchItem[] {
  const items: WatchItem[] = [];
  for (const item of playlist.items) {
    if (isClipItem(item)) {
      if (!item.r2Url) continue;
      const key = clipKey(item.matchId, item.eventId);
      const event = eventByKey.get(key);
      if (!event) continue;
      items.push({ kind: "clip", key, event, matchId: item.matchId, r2Url: item.r2Url, note: item.note, ...clipWatchEffects(item, item.r2Url) });
    } else {
      items.push({ kind: "text", key: `text:${item.id}`, card: item });
    }
  }
  return items;
}

/** True when the clips come from more than one game, so each row names its game. */
export function isMultiGame(items: WatchItem[]): boolean {
  const games = new Set<string>();
  for (const item of items) if (item.kind === "clip") games.add(item.matchId);
  return games.size > 1;
}

/**
 * Where Resume starts: the first uploaded clip not yet watched, or null when
 * every one has been (or there are none).
 */
export function firstUnwatchedKey(playlist: Playlist, watched: Set<string>): string | null {
  const clip = playableClips(playlist).find((c) => !watched.has(clipViewKey(playlist.id, c.matchId, c.eventId)));
  return clip ? clipKey(clip.matchId, clip.eventId) : null;
}

/** Watched and total over the uploaded clips, so 100% is always reachable. */
export function watchProgress(playlist: Playlist, watched: Set<string>): { watched: number; total: number } {
  const clips = playableClips(playlist);
  return {
    watched: clips.filter((c) => watched.has(clipViewKey(playlist.id, c.matchId, c.eventId))).length,
    total: clips.length,
  };
}

/**
 * Whether the viewer gets a timeline they can drag. A clip counts as watched
 * once playback nears its end, so a player who could drag to the end would
 * mark it watched without watching it: players get a read-only progress
 * line. The playlist's owner and the coaches and admins of its club keep the
 * timeline, wherever they open it. Someone outside the club (an ex-member, a
 * playlist from another club) is a viewer like any player.
 */
export function canScrubPlaylist(
  viewer: { userId: string | null | undefined; myOrgs: OrgMembership[] },
  playlist: Pick<Playlist, "orgId" | "createdBy">,
): boolean {
  if (viewer.userId && playlist.createdBy === viewer.userId) return true;
  if (!playlist.orgId) return false;
  return isStaffRole(viewer.myOrgs.find((o) => o.orgId === playlist.orgId)?.role);
}

/**
 * Claims `key` in `recorded`: true the first time, false ever after. A watch
 * is recorded (and reported) only when this says so, however often playback
 * passes the watched point.
 */
export function recordOnce(recorded: Set<string>, key: string): boolean {
  if (recorded.has(key)) return false;
  recorded.add(key);
  return true;
}

/** A "#rgb" or "#rrggbb" colour, normalised to "#rrggbb"; null for anything else. */
function hexColor(raw: string | undefined): string | null {
  const v = raw?.trim() ?? "";
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return null;
}

/**
 * Jersey colours for a playlist whose team has none set (most: colours are
 * optional at import). Deep enough for white text on the cover, and never
 * the app's cyan, which is kept for controls.
 */
export const TINT_PALETTE = ["#c2410c", "#b91c1c", "#1d4ed8", "#15803d", "#7e22ce", "#a16207", "#be185d", "#0f766e"] as const;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The colour a playlist wears on the watch screen (its cover and header):
 * the team behind most of its clips, in that game's own colour if the coach
 * set one, else that team's own pick from TINT_PALETTE (the same team gets
 * the same colour everywhere). With no team at all, the seed (the
 * playlist's id) picks.
 */
export function playlistTint(
  items: WatchItem[],
  matchFor: (matchId: string) => Pick<StoredMatch, "homeTeam" | "awayTeam"> | undefined,
  seed: string,
): string {
  const votes = new Map<string, { n: number; color: string | null }>();
  for (const item of items) {
    if (item.kind !== "clip") continue;
    const side = item.event.eventTeam?.teamNumber ?? item.event.player?.teamNumber;
    const match = matchFor(item.matchId);
    if (!match || (side !== 1 && side !== 2)) continue;
    const team = side === 1 ? match.homeTeam : match.awayTeam;
    const key = team.name.trim().toLowerCase();
    if (!key) continue;
    const v = votes.get(key);
    votes.set(key, { n: (v?.n ?? 0) + 1, color: v?.color ?? hexColor(team.color) });
  }
  let best: { key: string; n: number; color: string | null } | null = null;
  for (const [key, v] of votes) if (!best || v.n > best.n) best = { key, ...v };
  if (best?.color) return best.color;
  return best ? teamTint(best.key) : TINT_PALETTE[hashString(seed) % TINT_PALETTE.length];
}

/**
 * A team's own pick from TINT_PALETTE, by name (case and spacing don't
 * matter): the same team wears the same colour on its playlists and on a
 * scouting report about it.
 */
export function teamTint(name: string): string {
  return TINT_PALETTE[hashString(name.trim().toLowerCase()) % TINT_PALETTE.length];
}
