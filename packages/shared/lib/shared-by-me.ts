/**
 * Pure derivation logic for the coach's "Shared by me" dashboard.
 *
 * Joins the coach's shared playlists × team members × recipients' clip views
 * into per-playlist rows with watch progress, plus the cross-playlist summary
 * that powers "Remind all". Extracted from the web/desktop/mobile components
 * (which were three hand-ported copies) so the numbers coaches act on are
 * derived — and tested — in exactly one place.
 */

import type { SharedPlaylist } from "./playlists-db";
import type { TeamMemberRef } from "./teams-db";
import type { PlaylistClipView } from "./clip-views-db";
import type { PlaylistClipItem } from "../types/match";

/** Structural subsets so callers (and tests) don't need full UserProfile/OrgTeam. */
export interface MemberProfileLike {
  fullName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}
export interface TeamLike {
  name: string;
}

export interface RecipientRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  watched: number;
  lastActivity: string | null;
}

export interface DashboardRow {
  playlist: SharedPlaylist;
  teamNames: string[];
  directCount: number;
  /** Clips a recipient can actually watch (shipped to R2). */
  playableCount: number;
  /** Clips not yet uploaded — shown as a hint, excluded from the denominator. */
  uploadingCount: number;
  newestSharedAt: string | null;
  recipients: RecipientRow[];
  completedCount: number;
  startedCount: number;
}

export interface BehindTarget {
  userId: string;
  name: string;
  playlistId: string;
  sharedAt: string;
}

export interface DashboardSummary {
  playlists: number;
  recipients: number;
  behind: number;
  behindTargets: BehindTarget[];
}

export type DashboardStatus = "attention" | "done";
export type DashboardStatusFilter = "all" | DashboardStatus | "issues";
export type DashboardSort = "recent" | "least" | "name";

/**
 * One row per shared playlist: who it reaches, and how far each recipient is.
 * Watch counts only include clips the recipient can actually play (r2Url set)
 * — an unshipped clip must never make a player look behind. Rows come back
 * newest-shared first.
 */
export function buildDashboardRows(input: {
  shared: SharedPlaylist[];
  teamMembers: TeamMemberRef[];
  views: PlaylistClipView[];
  memberMap: ReadonlyMap<string, MemberProfileLike>;
  teamMap: ReadonlyMap<string, TeamLike>;
  currentUserId: string | null;
}): DashboardRow[] {
  const { shared, teamMembers, views, memberMap, teamMap, currentUserId } = input;

  const membersByTeam = new Map<string, string[]>();
  for (const m of teamMembers) {
    if (!membersByTeam.has(m.teamId)) membersByTeam.set(m.teamId, []);
    membersByTeam.get(m.teamId)!.push(m.userId);
  }
  const viewsByPlaylist = new Map<string, PlaylistClipView[]>();
  for (const v of views) {
    if (!viewsByPlaylist.has(v.playlistId)) viewsByPlaylist.set(v.playlistId, []);
    viewsByPlaylist.get(v.playlistId)!.push(v);
  }

  return shared
    .map((pl): DashboardRow => {
      const clips = pl.items.filter((i): i is PlaylistClipItem => i.type === "clip");
      const playable = clips.filter((c) => !!c.r2Url);
      const playableKeys = new Set(playable.map((c) => `${c.matchId}:${c.eventId}`));

      // Everyone the playlist reaches, minus the coach themself.
      const recipientIds = new Set<string>(pl.userShares.map((u) => u.userId));
      for (const t of pl.teamShares) {
        for (const uid of membersByTeam.get(t.teamId) ?? []) recipientIds.add(uid);
      }
      if (currentUserId) recipientIds.delete(currentUserId);

      // Watched-per-recipient, counting only clips they can actually play.
      const watchedByUser = new Map<string, Set<string>>();
      const lastByUser = new Map<string, string>();
      for (const v of viewsByPlaylist.get(pl.id) ?? []) {
        const key = `${v.matchId}:${v.eventId}`;
        if (!playableKeys.has(key)) continue;
        if (!watchedByUser.has(v.userId)) watchedByUser.set(v.userId, new Set());
        watchedByUser.get(v.userId)!.add(key);
        const prev = lastByUser.get(v.userId);
        if (!prev || v.watchedAt > prev) lastByUser.set(v.userId, v.watchedAt);
      }

      const recipients: RecipientRow[] = [...recipientIds]
        .map((uid) => {
          const profile = memberMap.get(uid);
          return {
            userId: uid,
            name: profile?.fullName ?? profile?.email ?? "Unknown member",
            avatarUrl: profile?.avatarUrl ?? null,
            watched: watchedByUser.get(uid)?.size ?? 0,
            lastActivity: lastByUser.get(uid) ?? null,
          };
        })
        // Accountability order: least progress first, then by name.
        .sort((a, b) => a.watched - b.watched || a.name.localeCompare(b.name, "sv"));

      const total = playable.length;
      const completedCount = total > 0 ? recipients.filter((r) => r.watched >= total).length : 0;
      const startedCount = recipients.filter((r) => r.watched > 0).length;

      const newestSharedAt =
        [...pl.teamShares.map((t) => t.sharedAt), ...pl.userShares.map((u) => u.sharedAt)]
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? null;

      return {
        playlist: pl,
        teamNames: pl.teamShares.map((t) => teamMap.get(t.teamId)?.name ?? "Team"),
        directCount: pl.userShares.filter((u) => u.userId !== currentUserId).length,
        playableCount: total,
        uploadingCount: clips.length - playable.length,
        newestSharedAt,
        recipients,
        completedCount,
        startedCount,
      };
    })
    .sort((a, b) => (b.newestSharedAt ?? "").localeCompare(a.newestSharedAt ?? ""));
}

/** "attention" = someone hasn't finished; "done" = everyone has. */
export function statusOf(r: DashboardRow): DashboardStatus | null {
  if (r.recipients.length === 0) return null;
  return r.completedCount >= r.recipients.length ? "done" : "attention";
}

/**
 * Cross-playlist roll-up. behindTargets dedupes per player — "Remind all"
 * sends one email each (their most recently shared unfinished playlist),
 * never one per playlist.
 */
export function summarizeDashboard(rows: DashboardRow[]): DashboardSummary {
  const allRecipients = new Set<string>();
  const behindByPlayer = new Map<string, BehindTarget>();
  for (const r of rows) {
    for (const rec of r.recipients) {
      allRecipients.add(rec.userId);
      if (r.playableCount > 0 && rec.watched < r.playableCount) {
        const sharedAt = r.newestSharedAt ?? "";
        const prev = behindByPlayer.get(rec.userId);
        if (!prev || sharedAt > prev.sharedAt) {
          behindByPlayer.set(rec.userId, {
            userId: rec.userId,
            name: rec.name,
            playlistId: r.playlist.id,
            sharedAt,
          });
        }
      }
    }
  }
  return {
    playlists: rows.length,
    recipients: allRecipients.size,
    behind: behindByPlayer.size,
    behindTargets: [...behindByPlayer.values()],
  };
}

/** Team dropdown options; "Direct to members" appears once any row has a direct share. */
export function teamFilterOptions(
  rows: DashboardRow[],
  teamMap: ReadonlyMap<string, TeamLike>,
): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [{ value: "all", label: "All teams" }];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const t of r.playlist.teamShares) {
      if (!seen.has(t.teamId)) {
        seen.add(t.teamId);
        opts.push({ value: t.teamId, label: teamMap.get(t.teamId)?.name ?? "Team" });
      }
    }
  }
  if (rows.some((r) => r.playlist.userShares.length > 0)) {
    opts.push({ value: "direct", label: "Direct to members" });
  }
  return opts;
}

/**
 * Team + search narrow first so the chip counts describe what's reachable
 * under the current scope — the same convention as the player feed.
 */
export function filterByTeamAndQuery(
  rows: DashboardRow[],
  teamFilter: string,
  query: string,
): DashboardRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.playlist.name.toLowerCase().includes(q)) return false;
    if (teamFilter === "all") return true;
    if (teamFilter === "direct") return r.playlist.userShares.length > 0;
    return r.playlist.teamShares.some((t) => t.teamId === teamFilter);
  });
}

export function dashboardCounts(inTeam: DashboardRow[]): {
  all: number;
  attention: number;
  done: number;
  issues: number;
} {
  return {
    all: inTeam.length,
    attention: inTeam.filter((r) => statusOf(r) === "attention").length,
    done: inTeam.filter((r) => statusOf(r) === "done").length,
    issues: inTeam.filter((r) => r.uploadingCount > 0).length,
  };
}

export function visibleDashboardRows(
  inTeam: DashboardRow[],
  statusFilter: DashboardStatusFilter,
  sort: DashboardSort,
): DashboardRow[] {
  const filtered = inTeam.filter((r) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "issues") return r.uploadingCount > 0;
    return statusOf(r) === statusFilter;
  });
  if (sort === "name") {
    return [...filtered].sort((a, b) => a.playlist.name.localeCompare(b.playlist.name, "sv"));
  }
  if (sort === "least") {
    // The pre-practice view: playlists nobody finished float to the top.
    return [...filtered].sort((a, b) => {
      const ra = a.recipients.length ? a.completedCount / a.recipients.length : 1;
      const rb = b.recipients.length ? b.completedCount / b.recipients.length : 1;
      return ra - rb || (b.newestSharedAt ?? "").localeCompare(a.newestSharedAt ?? "");
    });
  }
  return filtered; // base rows are already newest-first
}

/** Recipients on this row with clips left — per-playlist remind targets. */
export function behindRecipients(row: DashboardRow): RecipientRow[] {
  if (row.playableCount === 0) return [];
  return row.recipients.filter((r) => r.watched < row.playableCount);
}
