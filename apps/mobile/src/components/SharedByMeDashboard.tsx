import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { router } from "expo-router";
import { getMySharedPlaylists, type SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
import { getTeamMembers, type TeamMemberRef } from "@scoutable/shared/lib/teams-db";
import { listPlaylistClipViews, type PlaylistClipView } from "@scoutable/shared/lib/clip-views-db";
import { sendPlaylistReminder } from "@scoutable/shared/lib/reminders-db";
import {
  buildDashboardRows,
  summarizeDashboard,
  teamFilterOptions,
  filterByTeamAndQuery,
  dashboardCounts,
  visibleDashboardRows,
  behindRecipients,
  type DashboardRow,
  type DashboardSort,
  type RecipientRow,
} from "@scoutable/shared/lib/shared-by-me";
import { rgba } from "@scoutable/shared/lib/theme-derived";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { relativeTime } from "@/lib/format";
import { successHaptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme-context";
import { useLargeText } from "@/lib/a11y";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Callout, GroupedList } from "@/components/ui/Group";
import { Icon } from "@/components/ui/Icon";
import { PopUpButton } from "@/components/ui/PopUpButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatCells } from "@/components/ui/StatCells";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";

type StatusFilter = "all" | "attention" | "done" | "issues";

/** Finished, started and not-started recipients as one bar (the web's WatchBar). */
function WatchBar({ done, started, total, className }: { done: number; started: number; total: number; className?: string }) {
  const donePct = total > 0 ? (done / total) * 100 : 0;
  const startedPct = total > 0 ? (Math.max(0, started - done) / total) * 100 : 0;
  return (
    <View className={`h-1 flex-row overflow-hidden rounded-full bg-fill-2 ${className ?? ""}`}>
      <View className="h-full bg-primary" style={{ width: `${donePct}%` }} />
      <View className="h-full bg-primary/[0.35]" style={{ width: `${startedPct}%` }} />
    </View>
  );
}

/**
 * The coach's side of sharing, as the web's Shared by me at phone width:
 * the roll-up in stat cells, then one grouped list whose rows open into their
 * recipients, with reminders where someone is behind: per playlist, or per
 * player in an opened row. Renders inside the screen's scroll view, which
 * owns the search.
 */
export function SharedByMeDashboard({ query, onClearQuery, refreshNonce }: { query: string; onClearQuery: () => void; refreshNonce: number }) {
  const colors = useThemeColors();
  const { teamMap, memberMap } = usePlaylists();
  const { user, activeOrg, activeOrgId } = useAuth();
  const currentUserId = user?.id ?? null;

  const [shared, setShared] = useState<SharedPlaylist[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRef[]>([]);
  const [views, setViews] = useState<PlaylistClipView[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [sort, setSort] = useState<DashboardSort>("recent");
  /** key = `${playlistId}:${userId}` — per-recipient nudge lifecycle. */
  const [remindState, setRemindState] = useState<Map<string, "sending" | "sent">>(new Map());
  const [remindingPlaylistId, setRemindingPlaylistId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMySharedPlaylists(supabase, activeOrgId ?? undefined).then(async (playlists) => {
      if (cancelled) return;
      const teamIds = [...new Set(playlists.flatMap((p) => p.teamShares.map((t) => t.teamId)))];
      const [members, clipViews] = await Promise.all([
        getTeamMembers(supabase, teamIds),
        listPlaylistClipViews(
          supabase,
          playlists.map((p) => p.id),
        ),
      ]);
      if (cancelled) return;
      setTeamMembers(members);
      setViews(clipViews);
      setShared(playlists);
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, refreshNonce]);

  // All derivation lives in @scoutable/shared/lib/shared-by-me (tested there);
  // this component only wires state to it and renders.
  const rows = useMemo<DashboardRow[]>(
    () => (shared ? buildDashboardRows({ shared, teamMembers, views, memberMap, teamMap, currentUserId }) : []),
    [shared, teamMembers, views, memberMap, teamMap, currentUserId],
  );
  const summary = useMemo(() => summarizeDashboard(rows), [rows]);
  const teamOptions = useMemo(() => teamFilterOptions(rows, teamMap), [rows, teamMap]);
  const inTeam = useMemo(() => filterByTeamAndQuery(rows, teamFilter, query), [rows, teamFilter, query]);
  const counts = useMemo(() => dashboardCounts(inTeam), [inTeam]);
  const visibleRows = useMemo(() => visibleDashboardRows(inTeam, statusFilter, sort), [inTeam, statusFilter, sort]);
  const uploadIssues = rows.filter((r) => r.uploadingCount > 0).length;

  async function handleRemind(playlistId: string, recipient: RecipientRow) {
    const key = `${playlistId}:${recipient.userId}`;
    setRemindState((prev) => new Map(prev).set(key, "sending"));
    try {
      await sendPlaylistReminder(supabase, playlistId, recipient.userId);
      setRemindState((prev) => new Map(prev).set(key, "sent"));
      successHaptic();
    } catch (e) {
      setRemindState((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      Alert.alert("Couldn't send reminder", (e as Error).message);
    }
  }

  /** Everyone behind on one playlist (its "Remind N" button). */
  async function bulkRemind(targets: { playlistId: string; userId: string }[]) {
    let sent = 0;
    let failed = 0;
    for (const t of targets) {
      try {
        await sendPlaylistReminder(supabase, t.playlistId, t.userId);
        sent++;
        setRemindState((prev) => new Map(prev).set(`${t.playlistId}:${t.userId}`, "sent"));
      } catch (e) {
        // Cooldown hits are expected on repeat taps — not failures.
        if (!(e as Error).message.includes("24 hours")) failed++;
      }
    }
    if (sent > 0) successHaptic();
    if (sent > 0 && failed === 0) {
      Alert.alert("Reminders sent", `Reminded ${sent} player${sent === 1 ? "" : "s"}`);
    } else if (sent > 0) {
      Alert.alert("Partially sent", `Reminded ${sent}, ${failed} failed`);
    } else if (failed === 0) {
      Alert.alert("Already reminded", "Everyone was already reminded recently");
    } else {
      Alert.alert("Couldn't send reminders", "Try again in a moment");
    }
  }

  async function handleRemindPlaylist(row: DashboardRow) {
    if (remindingPlaylistId) return;
    const targets = behindRecipients(row).map((r) => ({ playlistId: row.playlist.id, userId: r.userId }));
    if (targets.length === 0) return;
    setRemindingPlaylistId(row.playlist.id);
    try {
      await bulkRemind(targets);
    } finally {
      setRemindingPlaylistId(null);
    }
  }

  if (shared === null) {
    return (
      <View className="items-center justify-center py-20">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (rows.length === 0) {
    // Staff of a club get pointed at club setup: a new admin's first job is
    // teams and invites, which happen on the web (named in plain text: no
    // link, App Review rejected build 5 over a path to the pricing page).
    const canManageOrg = !!activeOrg && !activeOrg.isPersonal && (activeOrg.role === "coach" || activeOrg.role === "admin");
    return (
      <EmptyState
        icon="send"
        title="Nothing shared yet"
        body={
          canManageOrg
            ? "Share a playlist from the desktop editor and you'll see here who has watched what. New club? Create teams and invite coaches and players from the web."
            : "Share a playlist from the desktop editor and you'll see here who has watched what."
        }
      />
    );
  }

  return (
    <View className="gap-5">
      <StatCells
        cells={[
          { value: summary.playlists, label: summary.playlists === 1 ? "playlist shared" : "playlists shared" },
          { value: summary.recipients, label: summary.recipients === 1 ? "player reached" : "players reached" },
          {
            value: summary.behind,
            label: summary.behind === 1 ? "player hasn't finished" : "players haven't finished",
            warn: summary.behind > 0,
            onPress: summary.behind > 0 ? () => setStatusFilter("attention") : undefined,
            accessibilityHint: "Shows the playlists someone hasn't finished",
          },
        ]}
      />

      {uploadIssues > 0 && (
        <Callout
          tone="warning"
          icon="warning"
          action={
            <Button size="xs" variant="outline" onPress={() => setStatusFilter(statusFilter === "issues" ? "all" : "issues")}>
              {statusFilter === "issues" ? "Show all" : "Show"}
            </Button>
          }
        >
          {uploadIssues === 1
            ? "1 playlist has clips recipients can't see yet. Upload them from the desktop app."
            : `${uploadIssues} playlists have clips recipients can't see yet. Upload them from the desktop app.`}
        </Callout>
      )}

      <View className="gap-2">
        <SegmentedControl
          accessibilityLabel="Show"
          value={statusFilter === "issues" ? null : statusFilter}
          onValueChange={setStatusFilter}
          segments={[
            { value: "all", label: "All", detail: counts.all },
            { value: "attention", label: "Not finished", detail: counts.attention },
            { value: "done", label: "Finished", detail: counts.done },
          ]}
        />
        <View className="flex-row flex-wrap gap-2">
          {teamOptions.length > 2 && (
            <PopUpButton accessibilityLabel="Team" value={teamFilter} onValueChange={setTeamFilter} options={teamOptions} />
          )}
          <PopUpButton<DashboardSort>
            accessibilityLabel="Sort"
            value={sort}
            onValueChange={setSort}
            options={[
              { value: "recent", label: "Recently shared" },
              { value: "least", label: "Least watched first" },
              { value: "name", label: "Name" },
            ]}
          />
        </View>
      </View>

      {visibleRows.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body="No shared playlists match these filters."
          action={
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                setStatusFilter("all");
                setTeamFilter("all");
                onClearQuery();
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <GroupedList>
          {visibleRows.map((row) => (
            <PlaylistRow
              key={row.playlist.id}
              row={row}
              expanded={expandedId === row.playlist.id}
              onToggle={() => setExpandedId(expandedId === row.playlist.id ? null : row.playlist.id)}
              onRemindPlaylist={() => handleRemindPlaylist(row)}
              remindingPlaylist={remindingPlaylistId === row.playlist.id}
              remindBusy={remindingPlaylistId !== null}
              remindState={remindState}
              onRemind={(r) => handleRemind(row.playlist.id, r)}
            />
          ))}
        </GroupedList>
      )}
    </View>
  );
}

function PlaylistRow({
  row,
  expanded,
  onToggle,
  onRemindPlaylist,
  remindingPlaylist,
  remindBusy,
  remindState,
  onRemind,
}: {
  row: DashboardRow;
  expanded: boolean;
  onToggle: () => void;
  /** Reminds everyone behind on this playlist. */
  onRemindPlaylist: () => void;
  remindingPlaylist: boolean;
  remindBusy: boolean;
  remindState: Map<string, "sending" | "sent">;
  onRemind: (r: RecipientRow) => void;
}) {
  const colors = useThemeColors();
  const largeText = useLargeText();
  const total = row.recipients.length;
  const behind = behindRecipients(row).length;
  const reach = [...row.teamNames, row.directCount > 0 ? `${row.directCount} member${row.directCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(", ");
  const when = relativeTime(row.newestSharedAt ?? undefined);
  const meta = [reach || "No recipients", when ? `shared ${when}` : null, `${row.playableCount} clip${row.playableCount === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <View>
      <View className="flex-row items-center gap-2 py-2 pl-1 pr-2">
        <Tappable
          scaleTo={1}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${row.playlist.name}. ${meta}`}
          accessibilityHint={expanded ? "Hides who it was shared with" : "Shows who it was shared with"}
          onPress={onToggle}
          className={({ pressed }) => `min-w-0 flex-1 flex-row items-center gap-2 rounded-lg py-1 pl-1 ${pressed ? "bg-fill-2" : ""}`}
        >
          <View className="h-9 w-9 items-center justify-center">
            <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
              <Icon name="chevronRight" size={14} weight="semibold" color={colors.mutedForeground} />
            </View>
          </View>
          <View className="min-w-0 flex-1">
            <Text numberOfLines={2} className="font-medium">
              {row.playlist.name}
            </Text>
            <Text variant="callout" nums numberOfLines={1} className="text-muted-foreground">
              {meta}
            </Text>
            {row.uploadingCount > 0 && (
              <View className="mt-0.5 flex-row items-center gap-1">
                <Icon name="warning" size={13} color={colors.warning} />
                <Text variant="callout" className="shrink text-warning">
                  {row.uploadingCount === 1
                    ? "1 clip isn't uploaded, so recipients can't see it"
                    : `${row.uploadingCount} clips aren't uploaded, so recipients can't see them`}
                </Text>
              </View>
            )}
          </View>
        </Tappable>
        <Button
          size="icon-xs"
          variant="ghost"
          accessibilityLabel={`Watch ${row.playlist.name} as a player`}
          onPress={() => router.push(`/playlists/${row.playlist.id}`)}
          icon={<Icon name="play" size={14} color={colors.primary} />}
        />
      </View>
      <View className={cn("gap-3 pb-2.5 pl-12 pr-3", largeText ? "items-start" : "flex-row items-center")}>
        <View className={cn("flex-row items-center gap-3", largeText ? "self-stretch" : "flex-1")}>
          <WatchBar done={row.completedCount} started={row.startedCount} total={total} className="flex-1" />
          <Text variant="callout" nums className="shrink-0 text-muted-foreground">
            {total > 0 ? `${row.completedCount} of ${total} finished` : "No recipients"}
          </Text>
        </View>
        {behind > 0 && (
          <Button
            size="xs"
            variant="outline"
            loading={remindingPlaylist}
            disabled={remindBusy && !remindingPlaylist}
            onPress={onRemindPlaylist}
            icon={<Icon name="send" size={12} color={colors.foreground} />}
          >
            {`Remind ${behind}`}
          </Button>
        )}
      </View>

      {expanded && (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          // Reanimated's views don't take className here: the web's border-t and bg-fill-1/50 by hand.
          style={{ borderTopWidth: 1, borderTopColor: colors.separator, backgroundColor: rgba(colors.foreground, 0.025), paddingVertical: 4 }}
        >
          {row.recipients.length === 0 ? (
            <Text variant="callout" className="px-12 py-3 text-muted-foreground">
              No recipients yet. Share this playlist with a team or a player.
            </Text>
          ) : (
            row.recipients.map((r) => {
              const done = row.playableCount > 0 && r.watched >= row.playableCount;
              const started = r.watched > 0;
              const active = relativeTime(r.lastActivity ?? undefined);
              const state = remindState.get(`${row.playlist.id}:${r.userId}`);
              return (
                <View key={r.userId} className="gap-1.5 py-2 pl-12 pr-3">
                  <View className="flex-row items-center gap-2">
                    <Avatar name={r.name} url={r.avatarUrl ?? undefined} size={24} />
                    <Text numberOfLines={1} className="min-w-0 flex-1">
                      {r.name}
                    </Text>
                    <Badge variant={done ? "success" : started ? "secondary" : "outline"}>
                      {done ? "Finished" : started ? "In progress" : "Not started"}
                    </Badge>
                  </View>
                  <View className="flex-row items-center gap-2 pl-8">
                    <WatchBar done={done ? 1 : 0} started={started ? 1 : 0} total={1} className="flex-1" />
                    <Text variant="subheadline" nums className="text-muted-foreground">
                      {r.watched}/{row.playableCount}
                    </Text>
                  </View>
                  <View className="flex-row items-center justify-between gap-2 pl-8">
                    <Text variant="subheadline" className="text-muted-foreground">
                      {active ? `Active ${active}` : "No activity"}
                    </Text>
                    {!done &&
                      (state === "sent" ? (
                        <View className="flex-row items-center gap-1">
                          <Icon name="check" size={12} color={colors.mutedForeground} />
                          <Text variant="subheadline" className="text-muted-foreground">
                            Reminded
                          </Text>
                        </View>
                      ) : (
                        <Button size="xs" variant="ghost" textClassName="text-primary" loading={state === "sending"} onPress={() => onRemind(r)}>
                          Remind
                        </Button>
                      ))}
                  </View>
                </View>
              );
            })
          )}
        </Animated.View>
      )}
    </View>
  );
}
