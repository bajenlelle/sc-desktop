"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ChevronRight, Loader2, MoreHorizontal, Send } from "lucide-react";
import { toast } from "sonner";
import {
  behindRecipients,
  buildDashboardRows,
  dashboardCounts,
  filterByTeamAndQuery,
  summarizeDashboard,
  teamFilterOptions,
  visibleDashboardRows,
  type DashboardRow,
  type DashboardSort,
  type DashboardStatusFilter,
  type RecipientRow,
} from "@scoutable/shared/lib/shared-by-me";
import type { SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
import { getTeamMembers, type TeamMemberRef } from "@scoutable/shared/lib/teams-db";
import type { Playlist } from "@scoutable/shared/types/match";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import { createClient } from "@/lib/supabase/client";
import { listPlaylistClipViews, type PlaylistClipView } from "@/lib/clip-views-db";
import { sendPlaylistReminder } from "@/lib/reminders-db";
import { trackEvent } from "@/lib/analytics";
import { relativeTime } from "@/lib/format-date";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { StatCells } from "@/components/stat-cells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Callout, GroupedList } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PersonAvatar } from "./share-recipients";

const SORT_OPTIONS: { value: DashboardSort; label: string }[] = [
  { value: "recent", label: "Recently shared" },
  { value: "least", label: "Least watched first" },
  { value: "name", label: "Name" },
];

/**
 * Finished, in progress and not started on one track: the lighter part is
 * started-but-not-finished. Completion alone hid partial engagement. Both
 * layers move with transforms.
 */
function WatchBar({ done, started, total, className }: { done: number; started: number; total: number; className?: string }) {
  const f = (n: number) => (total > 0 ? Math.min(1, n / total) : 0);
  return (
    <div className={cn("relative h-1 overflow-hidden rounded-full bg-fill-2", className)} aria-hidden>
      <div
        className="absolute inset-0 origin-left rounded-full bg-primary/35 transition-transform duration-300 ease-spring"
        style={{ transform: `scaleX(${f(started)})` }}
      />
      <div
        className="absolute inset-0 origin-left rounded-full bg-primary transition-transform duration-300 ease-spring"
        style={{ transform: `scaleX(${f(done)})` }}
      />
    </div>
  );
}

/**
 * The coach's side of sharing: every playlist they own that reaches a team
 * or a player, with who has watched what. Reads recipients' clip_views
 * through the owner-read RLS added for exactly this surface; the
 * derivations (rows, counts, filters, who is behind) live in
 * @scoutable/shared/lib/shared-by-me.
 */
export function SharedByMe({
  shared,
  memberMap,
  teamMap,
  currentUserId,
  query,
  onOpenPlaylist,
  onManageShare,
}: {
  /**
   * The coach's shared playlists, owned by the page; null while it loads.
   * The page holds them so the full nested payload is fetched once, not on
   * every mount and switch of view.
   */
  shared: SharedPlaylist[] | null;
  memberMap: Map<string, UserProfile>;
  teamMap: Map<string, OrgTeam>;
  currentUserId: string | null;
  /** From the toolbar's search field. */
  query: string;
  /** Opens the playlist in the page's watch view (?p= routing): see it as players do. */
  onOpenPlaylist: (id: string) => void;
  onManageShare: (pl: Playlist) => void;
}) {
  const [teamMembers, setTeamMembers] = useState<TeamMemberRef[]>([]);
  const [views, setViews] = useState<PlaylistClipView[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Filter and sort answer the coach's standing questions: "who hasn't
  // watched?" (status), "just this team" (team), "what needs chasing first" (sort).
  const [statusFilter, setStatusFilter] = useState<DashboardStatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [sort, setSort] = useState<DashboardSort>("recent");
  /** key = `${playlistId}:${userId}`, each recipient's nudge. */
  const [remindState, setRemindState] = useState<Map<string, "sending" | "sent">>(new Map());
  const [remindingPlaylistId, setRemindingPlaylistId] = useState<string | null>(null);

  // Keyed on the id sets, so an unrelated re-render doesn't refetch.
  const isLoading = shared === null;
  const sharedIdsKey = (shared ?? []).map((p) => p.id).join(",");
  const teamIdsKey = [...new Set((shared ?? []).flatMap((p) => p.teamShares.map((t) => t.teamId)))].sort().join(",");

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    const playlistIds = sharedIdsKey ? sharedIdsKey.split(",") : [];
    const teamIds = teamIdsKey ? teamIdsKey.split(",") : [];
    Promise.all([getTeamMembers(createClient(), teamIds), listPlaylistClipViews(playlistIds)])
      .then(([members, clipViews]) => {
        if (cancelled) return;
        setTeamMembers(members);
        setViews(clipViews);
      })
      .catch((e) => console.error("SharedByMe recipients:", e));
    return () => {
      cancelled = true;
    };
  }, [isLoading, sharedIdsKey, teamIdsKey]);

  const rows = useMemo<DashboardRow[]>(
    () => (shared ? buildDashboardRows({ shared, teamMembers, views, memberMap, teamMap, currentUserId }) : []),
    [shared, teamMembers, views, memberMap, teamMap, currentUserId],
  );
  const summary = useMemo(() => summarizeDashboard(rows), [rows]);
  const teamOptions = useMemo(() => teamFilterOptions(rows, teamMap), [rows, teamMap]);
  const inTeam = useMemo(() => filterByTeamAndQuery(rows, teamFilter, query), [rows, teamFilter, query]);
  const counts = useMemo(() => dashboardCounts(inTeam), [inTeam]);
  const visibleRows = useMemo(() => visibleDashboardRows(inTeam, statusFilter, sort), [inTeam, statusFilter, sort]);

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

  /**
   * Reminds everyone on one playlist who hasn't finished it. Per playlist,
   * never across the dashboard: a blast nudged players about weeks-old
   * playlists.
   */
  async function handleRemindPlaylist(row: DashboardRow) {
    if (remindingPlaylistId) return;
    const targets = behindRecipients(row).map((r) => ({ playlistId: row.playlist.id, userId: r.userId }));
    if (targets.length === 0) return;
    setRemindingPlaylistId(row.playlist.id);
    try {
      let sent = 0;
      let failed = 0;
      for (const t of targets) {
        try {
          await sendPlaylistReminder(t.playlistId, t.userId);
          sent++;
          setRemindState((prev) => new Map(prev).set(`${t.playlistId}:${t.userId}`, "sent"));
        } catch (e) {
          // Cooldown hits are expected on repeat clicks, not failures.
          if (!(e as Error).message.includes("24 hours")) failed++;
        }
      }
      trackEvent("reminder_sent", { bulk: true, count: targets.length });
      if (sent > 0 && failed === 0) toast.success(`Reminded ${sent} player${sent === 1 ? "" : "s"}`);
      else if (sent > 0) toast.warning(`Reminded ${sent}, ${failed} failed`);
      else if (failed === 0) toast.info("Everyone was already reminded recently");
      else toast.error("Couldn't send reminders. Try again.");
    } finally {
      setRemindingPlaylistId(null);
    }
  }

  function copyLink(row: DashboardRow) {
    navigator.clipboard
      .writeText(`${window.location.origin}/my-playlists?p=${row.playlist.id}`)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn't copy the link"));
  }

  if (shared === null) {
    return (
      <GroupedList aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-4">
            <div className="h-3 w-40 rounded bg-fill-2 motion-safe:animate-pulse" />
            <div className="ml-auto h-1 w-28 rounded bg-fill-2" />
          </div>
        ))}
      </GroupedList>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Send />}
        title="Nothing shared yet"
        body="Share a playlist from the desktop app and you'll see here who has watched what."
        action={
          <Button variant="outline" size="sm" asChild>
            <a href="https://scoutable.se/#download" target="_blank" rel="noreferrer">
              Get the desktop app
            </a>
          </Button>
        }
      />
    );
  }

  const withIssues = rows.filter((r) => r.uploadingCount > 0).length;

  const remindPlaylistButton = (row: DashboardRow, behind: number) => (
    <Button
      size="xs"
      variant="outline"
      disabled={remindingPlaylistId !== null}
      onClick={() => handleRemindPlaylist(row)}
      title={`Remind the ${behind} who haven't finished`}
    >
      {remindingPlaylistId === row.playlist.id ? <Loader2 className="animate-spin" /> : <Send />}
      Remind <span className="nums">{behind}</span>
    </Button>
  );

  const remindRecipientButton = (row: DashboardRow, r: RecipientRow) => {
    const reminded = remindState.get(`${row.playlist.id}:${r.userId}`);
    return reminded === "sent" ? (
      <span className="flex items-center gap-1 text-callout text-muted-foreground">
        <Check className="size-3.5" />
        Reminded
      </span>
    ) : (
      <Button size="xs" variant="ghost" disabled={reminded === "sending"} onClick={() => handleRemind(row.playlist.id, r)}>
        {reminded === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
        Remind
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <StatCells
        cells={[
          { value: summary.playlists, label: summary.playlists === 1 ? "playlist shared" : "playlists shared" },
          { value: summary.recipients, label: summary.recipients === 1 ? "player reached" : "players reached" },
          {
            value: summary.behind,
            label: summary.behind === 1 ? "player hasn't finished" : "players haven't finished",
            warn: summary.behind > 0,
            onClick: summary.behind > 0 ? () => setStatusFilter("attention") : undefined,
            title: "Show playlists someone hasn't finished",
          },
        ]}
      />

      {withIssues > 0 && (
        <Callout
          tone="warning"
          icon={<AlertTriangle />}
          action={
            <Button size="xs" variant="outline" onClick={() => setStatusFilter(statusFilter === "issues" ? "all" : "issues")}>
              {statusFilter === "issues" ? "Show all" : "Show"}
            </Button>
          }
        >
          {withIssues === 1
            ? "1 playlist has clips recipients can't see yet. Upload them from the desktop app."
            : `${withIssues} playlists have clips recipients can't see yet. Upload them from the desktop app.`}
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Show"
          // While the callout's "Show" filters to upload issues, no segment is on.
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: "all", label: <>All <span className="opacity-60 nums">{counts.all}</span></> },
            { value: "attention", label: <>Not finished <span className="opacity-60 nums">{counts.attention}</span></> },
            { value: "done", label: <>Finished <span className="opacity-60 nums">{counts.done}</span></> },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          {teamOptions.length > 2 && (
            <PopUpButton
              size="sm"
              aria-label="Team"
              align="end"
              value={teamFilter}
              onValueChange={setTeamFilter}
              options={teamOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          )}
          <PopUpButton size="sm" aria-label="Sort" align="end" value={sort} onValueChange={setSort} options={SORT_OPTIONS} />
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          body="No shared playlists match these filters."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter("all");
                setTeamFilter("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <GroupedList>
          {visibleRows.map((row) => {
            const expanded = expandedId === row.playlist.id;
            const total = row.recipients.length;
            const behind = behindRecipients(row).length;
            const reach = [
              ...row.teamNames,
              row.directCount > 0 ? `${row.directCount} member${row.directCount === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(", ");
            const when = relativeTime(row.newestSharedAt);
            const toggle = () => setExpandedId(expanded ? null : row.playlist.id);
            const finished = total > 0 ? `${row.completedCount} of ${total} finished` : "No recipients";
            return (
              <div key={row.playlist.id}>
                <div className="flex items-center gap-3 py-2 pr-2 pl-2 sm:min-h-14 sm:pr-3">
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={expanded}
                    aria-label={expanded ? "Hide recipients" : "Show recipients"}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-9"
                  >
                    <ChevronRight className={cn("size-4 transition-transform duration-200 ease-spring", expanded && "rotate-90")} />
                  </button>
                  {/* A pointer target only: the chevron is the keyboard control. */}
                  <div onClick={toggle} className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{row.playlist.name}</span>
                    <span className="truncate text-callout text-muted-foreground nums">
                      {[reach || "No recipients", when && `shared ${when}`, `${row.playableCount} clip${row.playableCount === 1 ? "" : "s"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {row.uploadingCount > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-callout text-warning">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {row.uploadingCount === 1
                          ? "1 clip isn't uploaded, so recipients can't see it"
                          : `${row.uploadingCount} clips aren't uploaded, so recipients can't see them`}
                      </span>
                    )}
                  </div>
                  {/* Beside the title from sm; on a phone they take a line of their own. */}
                  <div className="hidden w-32 shrink-0 flex-col items-end gap-1.5 sm:flex">
                    <span className="text-callout text-muted-foreground nums">{finished}</span>
                    <WatchBar done={row.completedCount} started={row.startedCount} total={total} className="w-full" />
                  </div>
                  <div className="hidden w-24 shrink-0 justify-end sm:flex">
                    {behind > 0 && remindPlaylistButton(row, behind)}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-xs" variant="ghost" aria-label="More" className="shrink-0">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onOpenPlaylist(row.playlist.id)}>Watch as a player</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => copyLink(row)}>Copy link</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onManageShare(row.playlist)}>Share…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-3 pr-3 pb-2.5 pl-11 sm:hidden">
                  <WatchBar done={row.completedCount} started={row.startedCount} total={total} className="flex-1" />
                  <span className="shrink-0 text-callout text-muted-foreground nums">{finished}</span>
                  {behind > 0 && remindPlaylistButton(row, behind)}
                </div>

                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      key="recipients"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springs.standard}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-separator bg-fill-1/50 py-1">
                        {row.recipients.length === 0 ? (
                          <p className="px-11 py-2 text-callout text-muted-foreground">
                            No recipients yet. Share this playlist with a team or a player.
                          </p>
                        ) : (
                          row.recipients.map((r) => {
                            const done = row.playableCount > 0 && r.watched >= row.playableCount;
                            const started = r.watched > 0;
                            const activity = relativeTime(r.lastActivity);
                            const badge = done ? (
                              <Badge variant="success">Finished</Badge>
                            ) : started ? (
                              <Badge variant="secondary">In progress</Badge>
                            ) : (
                              <Badge variant="outline">Not started</Badge>
                            );
                            const progress = (
                              <>
                                <WatchBar done={r.watched} started={r.watched} total={row.playableCount} className="flex-1" />
                                <span className="text-subheadline text-muted-foreground nums">
                                  {r.watched}/{row.playableCount}
                                </span>
                              </>
                            );
                            return (
                              <div key={r.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 pr-3 pl-11 sm:min-h-10 sm:flex-nowrap sm:py-1.5">
                                <PersonAvatar name={r.name} url={r.avatarUrl} />
                                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                                <span className="hidden w-28 shrink-0 items-center gap-2 sm:flex">{progress}</span>
                                <span className="shrink-0 sm:w-24">{badge}</span>
                                <span className="hidden w-16 shrink-0 text-right text-subheadline text-muted-foreground nums sm:block">
                                  {activity ?? "—"}
                                </span>
                                <span className="hidden w-24 shrink-0 justify-end sm:flex">{!done && remindRecipientButton(row, r)}</span>
                                {/* A phone's second line: progress, last activity, Remind. */}
                                <div className="flex w-full items-center gap-2 pl-9 sm:hidden">
                                  {progress}
                                  <span className="shrink-0 text-subheadline text-muted-foreground nums">{activity ?? "No activity"}</span>
                                  {!done && remindRecipientButton(row, r)}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </GroupedList>
      )}
    </div>
  );
}
