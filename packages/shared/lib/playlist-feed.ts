/**
 * Pure logic for the player-facing playlist feed: watch state, filters, chip
 * counts, and the hero call-to-action. Extracted from the web/desktop/mobile
 * PlaylistFeed components (three hand-ported copies). Also the single home
 * for the relativeTimeShort/initials formatters that were byte-identical in
 * seven files.
 */

/** The feed's view-model — previously copied as PlaylistCardData in 3 apps. */
export interface FeedPlaylist {
  id: string;
  name: string;
  clipCount: number;
  watchedCount: number;
  sharedAt?: string;
  /** Newest clip watch — orders "In progress" as continue-watching. */
  lastWatchedAt?: string;
  /** User id of the sharer — drives the "Shared by" filter. */
  sharerId?: string;
  sharerName?: string;
  sharerAvatarUrl?: string;
  /** Shared straight to this player rather than to one of their teams. */
  isDirect?: boolean;
  /** Teams this playlist reached the player through — drives the source filter. */
  teamIds?: string[];
  /** Resolved team names, shown muted next to the title. */
  teamNames?: string[];
}

export type WatchState = "new" | "progress" | "watched";
export type WatchFilter = "all" | WatchState;

export type FeedHero =
  | { kind: "continue"; playlist: FeedPlaylist }
  | { kind: "start"; playlist: FeedPlaylist; count: number }
  | { kind: "done" }
  | null;

export function watchStateOf(p: FeedPlaylist): WatchState {
  if (p.watchedCount === 0) return "new";
  if (p.clipCount > 0 && p.watchedCount >= p.clipCount) return "watched";
  return "progress";
}

/** source is "all" | "direct" | `team:<id>`; unknown strings pass everything. */
export function matchesSource(p: FeedPlaylist, source: string): boolean {
  if (source === "all") return true;
  if (source === "direct") return !!p.isDirect;
  if (source.startsWith("team:")) return (p.teamIds ?? []).includes(source.slice(5));
  return true;
}

export const byNewest = (a: FeedPlaylist, b: FeedPlaylist): number =>
  (b.sharedAt ?? "").localeCompare(a.sharedAt ?? "");

/**
 * Continue-watching order: the playlist touched most recently first, so
 * resuming is always the top card. Falls back to share date.
 */
export const byLastWatched = (a: FeedPlaylist, b: FeedPlaylist): number =>
  (b.lastWatchedAt ?? b.sharedAt ?? "").localeCompare(a.lastWatchedAt ?? a.sharedAt ?? "");

/** A "Shared by" filter only earns its place with 2+ distinct sharers. */
export function sharerFilterOptions(
  playlists: FeedPlaylist[],
): { value: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const p of playlists) {
    if (p.sharerId && !byId.has(p.sharerId)) byId.set(p.sharerId, p.sharerName ?? "Unknown");
  }
  if (byId.size < 2) return [];
  return [
    { value: "all", label: "Everyone" },
    ...[...byId].map(([value, label]) => ({ value, label })),
  ];
}

/**
 * Sharer + source + search narrow first, so the chip counts describe what's
 * actually reachable under the current scope rather than the whole library.
 */
export function filterFeed(
  playlists: FeedPlaylist[],
  f: { query: string; sharer: string; source: string },
): FeedPlaylist[] {
  const q = f.query.trim().toLowerCase();
  return playlists
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .filter((p) => f.sharer === "all" || p.sharerId === f.sharer)
    .filter((p) => matchesSource(p, f.source));
}

export function feedCounts(inSource: FeedPlaylist[]): Record<WatchFilter, number> {
  const c: Record<WatchFilter, number> = {
    all: inSource.length,
    new: 0,
    progress: 0,
    watched: 0,
  };
  for (const p of inSource) c[watchStateOf(p)] += 1;
  return c;
}

export function visibleFeed(inSource: FeedPlaylist[], watch: WatchFilter): FeedPlaylist[] {
  return watch === "all" ? inSource : inSource.filter((p) => watchStateOf(p) === watch);
}

/**
 * The one thing to do next: resume the most recently touched in-progress
 * playlist, else start the newest unwatched one. Callers must pass ALL
 * playlists (not the filtered view) — the hero is a call to action, not a
 * search result.
 */
export function computeHero(playlists: FeedPlaylist[]): FeedHero {
  const inProgress = playlists.filter((p) => watchStateOf(p) === "progress").sort(byLastWatched);
  if (inProgress.length > 0) return { kind: "continue", playlist: inProgress[0] };
  const fresh = playlists.filter((p) => watchStateOf(p) === "new").sort(byNewest);
  if (fresh.length > 0) return { kind: "start", playlist: fresh[0], count: fresh.length };
  if (playlists.length > 0) return { kind: "done" };
  return null;
}

/**
 * "2h ago", "3d ago", "12 apr" — short enough for a card, precise enough to
 * matter. `now` is injectable for tests; defaults to the current time.
 */
export function relativeTimeShort(iso?: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : parts[0].slice(0, 2)
  ).toUpperCase();
}

// ---------------------------------------------------------------------------
// Feed mapping — Playlist[] → FeedPlaylist[]
// ---------------------------------------------------------------------------

import { isClipItem, type Playlist, type PlaylistClipItem } from "../types/match";
import type { OrgTeam, UserProfile } from "../types/org";
import { clipViewKey } from "./clip-views-db";

/**
 * The clips a recipient can actually watch — only those shipped to R2.
 * Unshipped clips are invisible on the player surface (not greyed out), and
 * every progress denominator counts these, so 100% is always reachable.
 */
export function playableClips(pl: Playlist): PlaylistClipItem[] {
  return pl.items.filter(isClipItem).filter((c) => !!c.r2Url);
}

export interface FeedContext {
  /** Current user — their own (outbound) playlists are excluded from the feed. */
  userId?: string | null;
  clipViews: Set<string>;
  lastWatched: Map<string, string>;
  memberMap: Map<string, UserProfile>;
  teamMap: Map<string, OrgTeam>;
  directPlaylistIds: Set<string>;
}

/**
 * The ONE mapping from raw playlists to the feed's view-model — shared by the
 * feed list and the tab/app-icon badges so their counts physically cannot
 * drift. Note a playlist with zero shipped clips maps to watchedCount 0 and
 * therefore counts as "new" (watchStateOf) in the badge AND renders in the
 * feed's New section — exact parity is the contract; if product ever wants
 * empty playlists hidden, change watchStateOf/filtering once and every
 * surface follows.
 */
export function toFeedPlaylists(playlists: Playlist[], ctx: FeedContext): FeedPlaylist[] {
  return playlists
    .filter((pl) => !ctx.userId || pl.createdBy !== ctx.userId)
    .map((pl) => {
      const clips = playableClips(pl);
      const watchedCount = clips.filter((c) =>
        ctx.clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId))
      ).length;
      const sharer = pl.sharedBy ? ctx.memberMap.get(pl.sharedBy) : undefined;
      return {
        id: pl.id,
        name: pl.name,
        clipCount: clips.length,
        watchedCount,
        sharedAt: pl.sharedAt,
        lastWatchedAt: ctx.lastWatched.get(pl.id),
        sharerId: pl.sharedBy,
        // Email fallback: a sharer without full_name otherwise collapses to
        // the anonymous "Your coach".
        sharerName: sharer?.fullName ?? sharer?.email ?? undefined,
        sharerAvatarUrl: sharer?.avatarUrl ?? undefined,
        isDirect: ctx.directPlaylistIds.has(pl.id),
        teamIds: pl.teamIds ?? [],
        teamNames: (pl.teamIds ?? [])
          .map((id) => ctx.teamMap.get(id)?.name)
          .filter((n): n is string => !!n),
      };
    });
}
