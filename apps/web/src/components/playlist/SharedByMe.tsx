"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, Send, Share2, Users, X } from "lucide-react";
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
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { getMySharedPlaylists, type SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
import { getTeamMembers, type TeamMemberRef } from "@scoutable/shared/lib/teams-db";
import { listPlaylistClipViews, type PlaylistClipView } from "@/lib/clip-views-db";
import { sendPlaylistReminder } from "@/lib/reminders-db";
import type { Playlist, PlaylistClipItem } from "@scoutable/shared/types/match";
import type { UserProfile, OrgTeam } from "@scoutable/shared/types/org";

/** Search earns its place once the list stops fitting on one screen. */
const SEARCH_THRESHOLD = 10;

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
 * Done / in progress / not started at a glance. Completion alone hid partial
 * engagement — a squad at 90% each looked identical to one that never opened
 * the app.
 */
function SegmentedProgress({
  done,
  started,
  total,
  className,
}: {
  done: number;
  started: number;
  total: number;
  className?: string;
}) {
  const inProgress = Math.max(0, started - done);
  const donePct = total > 0 ? (done / total) * 100 : 0;
  const progressPct = total > 0 ? (inProgress / total) * 100 : 0;
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full bg-primary transition-all" style={{ width: `${donePct}%` }} />
      <div className="h-full bg-primary/40 transition-all" style={{ width: `${progressPct}%` }} />
    </div>
  );
}

function StatusPill({ done, started }: { done: boolean; started: boolean }) {
  return (
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
  );
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
  const [query, setQuery] = useState("");
  /** key = `${playlistId}:${userId}` — per-recipient nudge lifecycle. */
  const [remindState, setRemindState] = useState<Map<string, "sending" | "sent">>(new Map());
  const [remindingAll, setRemindingAll] = useState(false);
  const [remindingPlaylistId, setRemindingPlaylistId] = useState<string | null>(null);

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

  // Cross-playlist roll-up: the numbers the coach used to assemble by
  // expanding every row one at a time. behindTargets dedupes per player —
  // "Remind all" sends one email each (their most recently shared unfinished
  // playlist), never one per playlist.
  const summary = useMemo(() => {
    const allRecipients = new Set<string>();
    const behindByPlayer = new Map<string, { userId: string; name: string; playlistId: string; sharedAt: string }>();
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
  }, [rows]);

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

  // Team + search narrow first so the chip counts describe what's reachable
  // under the current scope — the same convention as the player feed.
  const inTeam = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.playlist.name.toLowerCase().includes(q)) return false;
      if (teamFilter === "all") return true;
      if (teamFilter === "direct") return r.playlist.userShares.length > 0;
      return r.playlist.teamShares.some((t) => t.teamId === teamFilter);
    });
  }, [rows, teamFilter, query]);

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

  async function handleRemind(playlistId: string, recipient: RecipientRow) {
    const key = `${playlistId}:${recipient.userId}`;
    setRemindState((prev) => new Map(prev).set(key, "sending"));
    try {
      await sendPlaylistReminder(playlistId, recipient.userId);
      setRemindState((prev) => new Map(prev).set(key, "sent"));
      toast.success(`Reminder sent to ${recipient.name}`);
    } catch (e) {
      setRemindState((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      toast.error((e as Error).message);
    }
  }

  /** Shared by the strip's global Remind all and the per-playlist button. */
  async function bulkRemind(targets: { playlistId: string; userId: string }[]) {
    let sent = 0;
    let failed = 0;
    for (const t of targets) {
      try {
        await sendPlaylistReminder(t.playlistId, t.userId);
        sent++;
        setRemindState((prev) => new Map(prev).set(`${t.playlistId}:${t.userId}`, "sent"));
      } catch (e) {
        // Cooldown hits are expected on repeat clicks — not failures.
        if (!(e as Error).message.includes("24 hours")) failed++;
      }
    }
    if (sent > 0 && failed === 0) {
      toast.success(`Reminded ${sent} player${sent === 1 ? "" : "s"}`);
    } else if (sent > 0) {
      toast.warning(`Reminded ${sent}, ${failed} failed`);
    } else if (failed === 0) {
      toast.info("Everyone was already reminded recently");
    } else {
      toast.error("Couldn't send reminders — try again");
    }
  }

  async function handleRemindAll() {
    if (remindingAll || summary.behindTargets.length === 0) return;
    setRemindingAll(true);
    try {
      await bulkRemind(summary.behindTargets);
    } finally {
      setRemindingAll(false);
    }
  }

  async function handleRemindPlaylist(row: DashboardRow) {
    if (remindingPlaylistId) return;
    const targets = row.recipients
      .filter((r) => row.playableCount > 0 && r.watched < row.playableCount)
      .map((r) => ({ playlistId: row.playlist.id, userId: r.userId }));
    if (targets.length === 0) return;
    setRemindingPlaylistId(row.playlist.id);
    try {
      await bulkRemind(targets);
    } finally {
      setRemindingPlaylistId(null);
    }
  }

  function RemindButton({ playlistId, recipient }: { playlistId: string; recipient: RecipientRow }) {
    const state = remindState.get(`${playlistId}:${recipient.userId}`);
    if (state === "sent") {
      return <span className="text-xs text-muted-foreground">Reminded ✓</span>;
    }
    return (
      <button
        type="button"
        onClick={() => handleRemind(playlistId, recipient)}
        disabled={state === "sending"}
        className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        {state === "sending" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        Remind
      </button>
    );
  }

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
      {/* Roll-up strip — the standing pre-practice question ("who's behind?")
          answered before any expanding. The behind stat doubles as a filter. */}
      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-lg font-semibold tabular-nums text-foreground">{summary.playlists}</span>
          <span className="text-xs text-muted-foreground">playlists shared</span>
        </div>
        <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-lg font-semibold tabular-nums text-foreground">{summary.recipients}</span>
          <span className="text-xs text-muted-foreground">players reached</span>
        </div>
        <div
          className={cn(
            "flex flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-2",
            summary.behind > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card",
          )}
        >
          <button
            type="button"
            onClick={() => setStatusFilter("attention")}
            title="Show playlists someone hasn't finished"
            className="flex min-w-0 flex-col text-left"
          >
            <span
              className={cn(
                "text-lg font-semibold tabular-nums",
                summary.behind > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground",
              )}
            >
              {summary.behind}
            </span>
            <span className="text-xs text-muted-foreground">
              {summary.behind === 1 ? "player hasn't finished" : "players haven't finished"}
            </span>
          </button>
          {summary.behind > 0 && (
            <button
              type="button"
              onClick={handleRemindAll}
              disabled={remindingAll}
              className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/25 disabled:opacity-60 dark:text-amber-400"
            >
              {remindingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Remind all
            </button>
          )}
        </div>
      </div>

      {rows.length > SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search playlists…"
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

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
            onClick={() => { setStatusFilter("all"); setTeamFilter("all"); setQuery(""); }}
            className="min-h-[32px] text-sm font-medium text-primary"
          >
            Clear filters
          </button>
        </div>
      )}

      {visibleRows.map((row) => {
        const expanded = expandedId === row.playlist.id;
        const total = row.recipients.length;
        const inProgress = Math.max(0, row.startedCount - row.completedCount);
        // Who on THIS playlist still has clips left — powers the per-playlist nudge.
        const behindCount =
          row.playableCount > 0
            ? row.recipients.filter((r) => r.watched < row.playableCount).length
            : 0;
        const reach = [
          ...row.teamNames,
          row.directCount > 0 ? `${row.directCount} member${row.directCount === 1 ? "" : "s"}` : null,
        ].filter(Boolean).join(", ");
        const when = relativeTime(row.newestSharedAt);

        return (
          <div key={row.playlist.id} className="rounded-xl border border-border bg-card">
            {/* The row div toggles on pointer click for the big target; the
                chevron is the real, focusable expand control (aria-expanded),
                and title/Share are sibling buttons that stop propagation —
                no interactive nesting, and a full keyboard path. */}
            <div
              className="flex w-full cursor-pointer items-center gap-3 p-4"
              onClick={() => setExpandedId(expanded ? null : row.playlist.id)}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedId(expanded ? null : row.playlist.id);
                }}
                aria-expanded={expanded}
                aria-label={expanded ? "Hide recipients" : "Show recipients"}
                className="-m-2 shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {expanded
                  ? <ChevronDown className="h-4 w-4" />
                  : <ChevronRight className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPlaylist(row.playlist.id);
                  }}
                  title="Open playlist"
                  className="block max-w-full truncate text-left text-sm font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline"
                >
                  {row.playlist.name}
                </button>
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
                  {row.completedCount} done
                  {inProgress > 0 && ` · ${inProgress} in progress`}
                  {total > 0 && ` of ${total}`}
                </span>
                <SegmentedProgress
                  done={row.completedCount}
                  started={row.startedCount}
                  total={total}
                  className="w-28"
                />
              </div>
              {behindCount > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemindPlaylist(row);
                  }}
                  disabled={remindingPlaylistId !== null}
                  title={`Remind the ${behindCount} player${behindCount === 1 ? "" : "s"} who haven't finished this playlist`}
                  className="flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/25 disabled:opacity-60 dark:text-amber-400"
                >
                  {remindingPlaylistId === row.playlist.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  <span>
                    Remind <span className="tabular-nums">{behindCount}</span>
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onManageShare(row.playlist);
                }}
                aria-label="Manage sharing"
                className="flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Share</span>
              </button>
            </div>

            {expanded && (
              <>
                {/* sm+: the four-column table */}
                <div className="hidden overflow-x-auto border-t border-border sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipient</TableHead>
                        <TableHead className="w-40">Progress</TableHead>
                        <TableHead className="w-24">Status</TableHead>
                        <TableHead className="w-24 text-right">Last activity</TableHead>
                        <TableHead className="w-24 text-right" aria-label="Actions" />
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
                              <StatusPill done={done} started={started} />
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {relativeTime(r.lastActivity) ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {!done && <RemindButton playlistId={row.playlist.id} recipient={r} />}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {row.recipients.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                            No recipients yet — share this playlist with a team or player.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Below sm: stacked rows — the table's four columns don't fit
                    a phone, and horizontal scroll hides the Remind action. */}
                <div className="border-t border-border sm:hidden">
                  {row.recipients.map((r) => {
                    const done = row.playableCount > 0 && r.watched >= row.playableCount;
                    const started = r.watched > 0;
                    const rpct = row.playableCount > 0 ? (r.watched / row.playableCount) * 100 : 0;
                    return (
                      <div key={r.userId} className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 last:border-b-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                              {r.avatarUrl
                                ? <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" />
                                : initials(r.name)}
                            </span>
                            <span className="truncate text-sm text-foreground">{r.name}</span>
                          </span>
                          <StatusPill done={done} started={started} />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full bg-primary transition-all"
                              style={{ width: `${rpct}%` }}
                            />
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {r.watched}/{row.playableCount}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            {relativeTime(r.lastActivity) ? `Active ${relativeTime(r.lastActivity)}` : "No activity"}
                          </span>
                          {!done && <RemindButton playlistId={row.playlist.id} recipient={r} />}
                        </div>
                      </div>
                    );
                  })}
                  {row.recipients.length === 0 && (
                    <p className="px-4 py-4 text-center text-sm text-muted-foreground">
                      No recipients yet — share this playlist with a team or player.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
