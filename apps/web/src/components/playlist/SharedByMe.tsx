"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Send, Share2, Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getMySharedPlaylists, type SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
import { getTeamMembers, type TeamMemberRef } from "@scoutable/shared/lib/teams-db";
import { listPlaylistClipViews, type PlaylistClipView } from "@/lib/clip-views-db";
import type { Playlist, PlaylistClipItem } from "@scoutable/shared/types/match";
import type { UserProfile, OrgTeam } from "@scoutable/shared/types/org";

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function relativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

interface RecipientRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  watched: number;
  lastActivity: string | null;
}

interface DashboardRow {
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

/**
 * The coach's side of sharing: every playlist they own that reaches a team
 * or player, with per-recipient watch status. Reads recipients' clip_views
 * through the owner-read RLS added for exactly this surface.
 */
export function SharedByMe({
  memberMap,
  teamMap,
  currentUserId,
  onOpenPlaylist,
  onManageShare,
}: {
  memberMap: Map<string, UserProfile>;
  teamMap: Map<string, OrgTeam>;
  currentUserId: string | null;
  /** Opens the playlist in the page's watch view (?p= routing). */
  onOpenPlaylist: (id: string) => void;
  onManageShare: (pl: Playlist) => void;
}) {
  const [shared, setShared] = useState<SharedPlaylist[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRef[]>([]);
  const [views, setViews] = useState<PlaylistClipView[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Filter/sort answer the coach's standing questions: "who hasn't watched?"
  // (status), "just this team" (team), "what needs chasing first" (sort).
  const [statusFilter, setStatusFilter] = useState<"all" | "attention" | "done" | "issues">("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [sort, setSort] = useState<"recent" | "least" | "name">("recent");

  useEffect(() => {
    let cancelled = false;
    getMySharedPlaylists(createClient()).then(async (playlists) => {
      if (cancelled) return;
      const teamIds = [...new Set(playlists.flatMap((p) => p.teamShares.map((t) => t.teamId)))];
      const [members, clipViews] = await Promise.all([
        getTeamMembers(createClient(), teamIds),
        listPlaylistClipViews(playlists.map((p) => p.id)),
      ]);
      if (cancelled) return;
      setTeamMembers(members);
      setViews(clipViews);
      setShared(playlists);
    });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<DashboardRow[]>(() => {
    if (!shared) return [];

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
  }, [shared, teamMembers, views, memberMap, teamMap, currentUserId]);

  /** "attention" = someone hasn't finished; "done" = everyone has. */
  function statusOf(r: DashboardRow): "attention" | "done" | null {
    if (r.recipients.length === 0) return null;
    return r.completedCount >= r.recipients.length ? "done" : "attention";
  }

  const teamOptions = useMemo(() => {
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
  }, [rows, teamMap]);

  // Team narrows first so the chip counts describe what's reachable under
  // the current team — the same convention as the player feed.
  const inTeam = useMemo(
    () =>
      rows.filter((r) => {
        if (teamFilter === "all") return true;
        if (teamFilter === "direct") return r.playlist.userShares.length > 0;
        return r.playlist.teamShares.some((t) => t.teamId === teamFilter);
      }),
    [rows, teamFilter],
  );

  const counts = useMemo(
    () => ({
      all: inTeam.length,
      attention: inTeam.filter((r) => statusOf(r) === "attention").length,
      done: inTeam.filter((r) => statusOf(r) === "done").length,
      issues: inTeam.filter((r) => r.uploadingCount > 0).length,
    }),
    [inTeam],
  );

  const visibleRows = useMemo(() => {
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
  }, [inTeam, statusFilter, sort]);

  const SORT_LABEL: Record<typeof sort, string> = {
    recent: "Recently shared",
    least: "Least watched first",
    name: "Name (A–Ö)",
  };

  if (shared === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <Send className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">You haven&apos;t shared any playlists yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Share one from the playlist editor and you&apos;ll see here who has watched what.
        </p>
      </div>
    );
  }

  const chips = [
    { key: "all" as const, label: "All" },
    { key: "attention" as const, label: "Not fully watched" },
    { key: "done" as const, label: "Fully watched" },
    { key: "issues" as const, label: "Upload issues" },
  ].filter((c) => c.key !== "issues" || counts.issues > 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-5 sm:px-6">
      {/* Filter bar — same visual language as the player feed's chip bar. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((c) => {
            const active = statusFilter === c.key;
            const n = counts[c.key];
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setStatusFilter(c.key)}
                className={cn(
                  "flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : c.key === "issues"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {c.label}
                <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {teamOptions.length > 2 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-[32px] shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground"
                >
                  <span className="max-w-[9rem] truncate">
                    {teamOptions.find((o) => o.value === teamFilter)?.label ?? "All teams"}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {teamOptions.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onClick={() => setTeamFilter(o.value)}
                    className={cn("text-sm", o.value === teamFilter && "font-semibold text-primary")}
                  >
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-h-[32px] shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground"
              >
                {SORT_LABEL[sort]}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(Object.keys(SORT_LABEL) as (typeof sort)[]).map((key) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => setSort(key)}
                  className={cn("text-sm", key === sort && "font-semibold text-primary")}
                >
                  {SORT_LABEL[key]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {visibleRows.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
          <button
            type="button"
            onClick={() => { setStatusFilter("all"); setTeamFilter("all"); }}
            className="min-h-[32px] text-sm font-medium text-primary"
          >
            Clear filters
          </button>
        </div>
      )}

      {visibleRows.map((row) => {
        const expanded = expandedId === row.playlist.id;
        const total = row.recipients.length;
        const pct = total > 0 ? Math.round((row.completedCount / total) * 100) : 0;
        const reach = [
          ...row.teamNames,
          row.directCount > 0 ? `${row.directCount} member${row.directCount === 1 ? "" : "s"}` : null,
        ].filter(Boolean).join(", ");
        const when = relativeTime(row.newestSharedAt);

        return (
          <div key={row.playlist.id} className="rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : row.playlist.id)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              {expanded
                ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                {/* The row expands the roster; the TITLE jumps into the
                    playlist itself — the page's watch view, the one real
                    player on web. */}
                <p className="truncate text-sm font-semibold text-foreground">
                  <span
                    role="link"
                    tabIndex={0}
                    title="Open playlist"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenPlaylist(row.playlist.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        onOpenPlaylist(row.playlist.id);
                      }
                    }}
                    className="underline-offset-2 hover:text-primary hover:underline"
                  >
                    {row.playlist.name}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  <Users className="mr-1 inline h-3 w-3" aria-hidden />
                  {reach || "No recipients"}
                  {when && ` · shared ${when}`}
                  {` · ${row.playableCount} clip${row.playableCount === 1 ? "" : "s"}`}
                </p>
                {row.uploadingCount > 0 && (
                  <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                    {row.uploadingCount} clip{row.uploadingCount === 1 ? "" : "s"} not uploaded — invisible to
                    recipients. Open the playlist in the desktop app to upload them.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {row.completedCount} of {total} watched everything
                </span>
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <span
                role="button"
                tabIndex={0}
                title="Manage sharing"
                onClick={(e) => { e.stopPropagation(); onManageShare(row.playlist); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onManageShare(row.playlist); } }}
                className="ml-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Share2 className="h-4 w-4" />
              </span>
            </button>

            {expanded && (
              <div className="overflow-x-auto border-t border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipient</TableHead>
                      <TableHead className="w-44">Progress</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-28 text-right">Last activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.recipients.map((r) => {
                      const done = row.playableCount > 0 && r.watched >= row.playableCount;
                      const started = r.watched > 0;
                      const rpct = row.playableCount > 0 ? (r.watched / row.playableCount) * 100 : 0;
                      return (
                        <TableRow key={r.userId}>
                          <TableCell>
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                                {r.avatarUrl
                                  ? <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" />
                                  : initials(r.name)}
                              </span>
                              <span className="truncate text-sm text-foreground">{r.name}</span>
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-primary transition-all"
                                  style={{ width: `${rpct}%` }}
                                />
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {r.watched}/{row.playableCount}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                done
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : started
                                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {done ? "Done" : started ? "In progress" : "Not started"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {relativeTime(r.lastActivity) ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {row.recipients.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          No recipients yet — share this playlist with a team or player.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}