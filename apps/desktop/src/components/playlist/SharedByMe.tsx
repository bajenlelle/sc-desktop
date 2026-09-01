import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Loader2, Pencil, Search, Send, Share2, Upload, Users, X } from "lucide-react";
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
import type { SharedPlaylist } from "@/lib/playlists-db";
import { getTeamMembers, type TeamMemberRef } from "@/lib/teams-db";
import { listPlaylistClipViews, type PlaylistClipView } from "@/lib/clip-views-db";
import { sendPlaylistReminder } from "@/lib/reminders-db";
import { bulkSendReminders } from "@/lib/reminders-bulk";
import { trackEvent } from "@/lib/analytics";
import {
  buildDashboardRows,
  summarizeDashboard,
  teamFilterOptions,
  filterByTeamAndQuery,
  dashboardCounts,
  visibleDashboardRows,
  behindRecipients,
  type DashboardRow,
  type RecipientRow,
  type DashboardStatusFilter,
  type DashboardSort,
} from "@scoutable/shared/lib/shared-by-me";
import { relativeTimeShort as relativeTime, initials } from "@scoutable/shared/lib/playlist-feed";
import type { Playlist } from "@/types/match";
import type { UserProfile, OrgTeam } from "@/types/org";

/** Search earns its place once the list stops fitting on one screen. */
const SEARCH_THRESHOLD = 10;

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
  shared,
  memberMap,
  teamMap,
  currentUserId,
  onOpenPlaylist,
  onManageShare,
}: {
  /**
   * The coach's shared playlists, owned by the page — `null` while it loads.
   * This component used to call getMySharedPlaylists() itself, so the full
   * nested payload (every playlist with every clip) was fetched twice on every
   * mount, and again on each coach-tab toggle.
   */
  shared: SharedPlaylist[] | null;
  memberMap: Map<string, UserProfile>;
  teamMap: Map<string, OrgTeam>;
  currentUserId: string | null;
  /** Opens the playlist in the page's watch view — see it as players do. */
  onOpenPlaylist: (pl: Playlist) => void;
  onManageShare: (pl: Playlist) => void;
}) {
  const navigate = useNavigate();
  const [teamMembers, setTeamMembers] = useState<TeamMemberRef[]>([]);
  const [views, setViews] = useState<PlaylistClipView[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Filter/sort answer the coach's standing questions: "who hasn't watched?"
  // (status), "just this team" (team), "what needs chasing first" (sort).
  const [statusFilter, setStatusFilter] = useState<DashboardStatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [sort, setSort] = useState<DashboardSort>("recent");
  const [query, setQuery] = useState("");
  /** key = `${playlistId}:${userId}` — per-recipient nudge lifecycle. */
  const [remindState, setRemindState] = useState<Map<string, "sending" | "sent">>(new Map());
  const [remindingAll, setRemindingAll] = useState(false);
  const [remindingPlaylistId, setRemindingPlaylistId] = useState<string | null>(null);

  // Recipients and watch state for the playlists the page handed us. Keyed on
  // the id SETS rather than the arrays, so an unrelated parent re-render (or a
  // clip edit elsewhere on the page) doesn't refetch either one.
  const isLoading = shared === null;
  const sharedIdsKey = (shared ?? []).map((p) => p.id).join(",");
  const teamIdsKey = [
    ...new Set((shared ?? []).flatMap((p) => p.teamShares.map((t) => t.teamId))),
  ]
    .sort()
    .join(",");

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    const playlistIds = sharedIdsKey ? sharedIdsKey.split(",") : [];
    const teamIds = teamIdsKey ? teamIdsKey.split(",") : [];
    Promise.all([getTeamMembers(teamIds), listPlaylistClipViews(playlistIds)])
      .then(([members, clipViews]) => {
        if (cancelled) return;
        setTeamMembers(members);
        setViews(clipViews);
      })
      .catch((e) => console.error("SharedByMe recipients:", e));
    return () => { cancelled = true; };
  }, [isLoading, sharedIdsKey, teamIdsKey]);

  // All derivation lives in @scoutable/shared/lib/shared-by-me (tested there);
  // this component only wires state to it and renders.
  const rows = useMemo<DashboardRow[]>(
    () =>
      shared
        ? buildDashboardRows({ shared, teamMembers, views, memberMap, teamMap, currentUserId })
        : [],
    [shared, teamMembers, views, memberMap, teamMap, currentUserId],
  );

  const summary = useMemo(() => summarizeDashboard(rows), [rows]);

  const teamOptions = useMemo(() => teamFilterOptions(rows, teamMap), [rows, teamMap]);

  const inTeam = useMemo(
    () => filterByTeamAndQuery(rows, teamFilter, query),
    [rows, teamFilter, query],
  );

  const counts = useMemo(() => dashboardCounts(inTeam), [inTeam]);

  const visibleRows = useMemo(
    () => visibleDashboardRows(inTeam, statusFilter, sort),
    [inTeam, statusFilter, sort],
  );

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
      trackEvent("reminder_sent", { bulk: false, count: 1 });
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

  /** Shared by the strip's global Remind all and the per-playlist button.
   * Loop + toasts live in lib/reminders-bulk (also used by the Home page). */
  async function bulkRemind(targets: { playlistId: string; userId: string }[]) {
    await bulkSendReminders(targets, (t) =>
      setRemindState((prev) => new Map(prev).set(`${t.playlistId}:${t.userId}`, "sent"))
    );
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
    const targets = behindRecipients(row).map((r) => ({
      playlistId: row.playlist.id,
      userId: r.userId,
    }));
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
        const behindCount = behindRecipients(row).length;
        const reach = [
          ...row.teamNames,
          row.directCount > 0 ? `${row.directCount} member${row.directCount === 1 ? "" : "s"}` : null,
        ].filter(Boolean).join(", ");
        const when = relativeTime(row.newestSharedAt);

        return (
          <div key={row.playlist.id} className="rounded-xl border border-border bg-card">
            {/* The row div toggles on pointer click for the big target; the
                chevron is the real, focusable expand control (aria-expanded),
                and title/actions are sibling buttons that stop propagation —
                no interactive nesting, and a full keyboard path. */}
            <div
              className="w-full cursor-pointer p-4"
              onClick={() => setExpandedId(expanded ? null : row.playlist.id)}
            >
              <div className="flex items-center gap-3">
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
                      onOpenPlaylist(row.playlist);
                    }}
                    title="Watch playlist"
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
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                      {row.uploadingCount} clip{row.uploadingCount === 1 ? "" : "s"} not uploaded — invisible to recipients
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate("/playlists", { state: { restore: { playlistId: row.playlist.id }, reship: true } });
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-1.5 py-0.5 font-medium transition-colors hover:bg-amber-500/10"
                      >
                        <Upload className="h-3 w-3" />
                        Upload missing clips
                      </button>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
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
                    title="Edit in playlist editor"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate("/playlists", { state: { restore: { playlistId: row.playlist.id } } });
                    }}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Manage sharing"
                    onClick={(e) => { e.stopPropagation(); onManageShare(row.playlist); }}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {expanded && (
              <div className="overflow-x-auto border-t border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipient</TableHead>
                      <TableHead className="w-44">Progress</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-28 text-right">Last activity</TableHead>
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
            )}
          </div>
        );
      })}
    </div>
  );
}
