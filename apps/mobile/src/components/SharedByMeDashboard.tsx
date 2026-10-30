import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withSpring } from "react-native-reanimated";
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
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { relativeTime } from "@/lib/format";
import { successHaptic } from "@/lib/haptics";
import { springs } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";
import { useLargeText } from "@/lib/a11y";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { NoticeRow, StatLine, TextButton } from "@/components/ui/Row";
import { Sheet } from "@/components/ui/Sheet";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { WatchBar } from "@/components/ui/WatchBar";
import { cn } from "@/lib/cn";

export type StatusFilter = "all" | "attention" | "done" | "issues";

export interface DashboardFilters {
  status: StatusFilter;
  team: string;
  sort: DashboardSort;
}

export const NO_DASHBOARD_FILTERS: DashboardFilters = { status: "all", team: "all", sort: "recent" };

/** How many of the dashboard's filters narrow it (sort only orders). */
export function activeDashboardFilterCount(f: DashboardFilters): number {
  return (f.status !== "all" ? 1 : 0) + (f.team !== "all" ? 1 : 0);
}

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  attention: "Not finished",
  done: "Finished",
  issues: "Upload issues",
};

/**
 * The coach's side of sharing, calmer than the web's Shared by me it comes
 * from: the roll-up as one line with its figures picked out, then one card
 * per playlist on the grouped floor. A card reads top to bottom as where it
 * went (the team), what it is (the name, then when and how many clips) and
 * how it's going (the web's watch bar and "n of m finished"); it has one
 * control, itself, which opens it into its recipients. Reminders and "Watch
 * as a player" live in the opened card; status, team and sort live in the
 * filter sheet behind the title bar's button. Renders inside the screen's
 * scroll view, which owns the search.
 */
export function SharedByMeDashboard({
  query,
  refreshNonce,
  filters,
  onFiltersChange,
  onClearFilters,
  sheetOpen,
  onCloseSheet,
  onRowCountChange,
}: {
  query: string;
  refreshNonce: number;
  filters: DashboardFilters;
  onFiltersChange: (next: DashboardFilters) => void;
  /** Resets the filters and the search. */
  onClearFilters: () => void;
  sheetOpen: boolean;
  onCloseSheet: () => void;
  /** How many shared playlists there are (null while loading), so the parent shows its filter button only when there is something to filter. */
  onRowCountChange?: (count: number | null) => void;
}) {
  const colors = useThemeColors();
  const toast = useToast();
  const { teamMap, memberMap } = usePlaylists();
  const { user, activeOrg, activeOrgId } = useAuth();
  const currentUserId = user?.id ?? null;

  const [shared, setShared] = useState<SharedPlaylist[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRef[]>([]);
  const [views, setViews] = useState<PlaylistClipView[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const inTeam = useMemo(() => filterByTeamAndQuery(rows, filters.team, query), [rows, filters.team, query]);
  const counts = useMemo(() => dashboardCounts(inTeam), [inTeam]);
  const visibleRows = useMemo(() => visibleDashboardRows(inTeam, filters.status, filters.sort), [inTeam, filters.status, filters.sort]);
  const uploadIssues = rows.filter((r) => r.uploadingCount > 0).length;
  useEffect(() => {
    onRowCountChange?.(shared === null ? null : rows.length);
  }, [shared, rows.length, onRowCountChange]);
  const setStatus = (status: StatusFilter) => onFiltersChange({ ...filters, status });

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

  /** Everyone behind on one playlist (its "Remind all" action). */
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
      toast.show(`Reminded ${sent} player${sent === 1 ? "" : "s"}.`);
    } else if (sent > 0) {
      toast.show(`Reminded ${sent}; ${failed} couldn't be sent.`, { tone: "warning" });
    } else if (failed === 0) {
      toast.show("Everyone was already reminded in the last 24 hours.", { tone: "neutral" });
    } else {
      Alert.alert("Couldn't send reminders", "Try again in a moment.");
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

  const sheet = (
    <Sheet
      visible={sheetOpen}
      onClose={onCloseSheet}
      title="Filters"
      trailing={
        activeDashboardFilterCount(filters) > 0 || filters.sort !== "recent" ? (
          <TextButton label="Reset" size="body" onPress={() => onFiltersChange(NO_DASHBOARD_FILTERS)} />
        ) : undefined
      }
    >
      <RadioGroup<StatusFilter>
        title="Show"
        value={filters.status}
        onSelect={setStatus}
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "attention", label: "Not finished", count: counts.attention },
          { value: "done", label: "Finished", count: counts.done },
          ...(uploadIssues > 0 ? [{ value: "issues" as const, label: "Upload issues", count: uploadIssues }] : []),
        ]}
      />
      {teamOptions.length > 2 && (
        <RadioGroup title="Team" value={filters.team} onSelect={(team) => onFiltersChange({ ...filters, team })} options={teamOptions} />
      )}
      <RadioGroup<DashboardSort>
        title="Sort"
        value={filters.sort}
        onSelect={(sort) => onFiltersChange({ ...filters, sort })}
        options={[
          { value: "recent", label: "Recently shared" },
          { value: "least", label: "Least watched first" },
          { value: "name", label: "Name" },
        ]}
      />
      <View className="px-4 pt-5">
        <Button onPress={onCloseSheet}>Done</Button>
      </View>
    </Sheet>
  );

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

  const activeLabels = [
    filters.status !== "all" ? STATUS_LABEL[filters.status] : null,
    filters.team !== "all" ? (teamOptions.find((o) => o.value === filters.team)?.label ?? "One team") : null,
  ].filter((x): x is string => !!x);

  return (
    <View>
      <StatLine
        className="pb-3 pt-1"
        parts={[
          { figure: summary.playlists, label: `${summary.playlists === 1 ? "playlist" : "playlists"} shared` },
          { figure: summary.recipients, label: `${summary.recipients === 1 ? "player" : "players"} reached` },
        ]}
        action={
          summary.behind > 0
            ? { label: `${summary.behind} ${summary.behind === 1 ? "hasn't" : "haven't"} finished`, onPress: () => setStatus("attention") }
            : undefined
        }
      />

      {activeLabels.length > 0 && (
        <Text variant="footnote" className="px-4 pb-2 text-muted-foreground">
          {activeLabels.join(" · ")} ·{" "}
          <Text variant="footnote" accessibilityRole="button" onPress={onClearFilters} className="font-semibold text-primary">
            Clear
          </Text>
        </Text>
      )}

      {uploadIssues > 0 && (
        <NoticeRow
          icon="warning"
          className="pb-3"
          actions={[
            {
              label: filters.status === "issues" ? "Show all" : "Show",
              onPress: () => setStatus(filters.status === "issues" ? "all" : "issues"),
              primary: true,
            },
          ]}
        >
          {uploadIssues === 1
            ? "1 playlist has clips recipients can't see yet. Upload them from the desktop app."
            : `${uploadIssues} playlists have clips recipients can't see yet. Upload them from the desktop app.`}
        </NoticeRow>
      )}

      {visibleRows.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body="No shared playlists match these filters."
          action={<TextButton label="Clear filters" onPress={onClearFilters} />}
        />
      ) : (
        <View className="gap-3">
            {visibleRows.map((row) => (
              <PlaylistCard
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
        </View>
      )}
      {sheet}
    </View>
  );
}

/** "Superettan Herr", "Basketettan Dam, Superettan Herr", "Superettan Herr, 2 members". */
function reachLabel(row: DashboardRow): string {
  return [...row.teamNames, row.directCount > 0 ? `${row.directCount} member${row.directCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(", ");
}

function PlaylistCard({
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
  const [showFinished, setShowFinished] = useState(false);
  const total = row.recipients.length;
  const behind = behindRecipients(row);
  const reach = reachLabel(row);
  const when = relativeTime(row.newestSharedAt ?? undefined);
  const meta = [when ? `Shared ${when}` : null, `${row.playableCount} clip${row.playableCount === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");
  const watching = Math.max(0, row.startedCount - row.completedCount);
  const progress =
    total === 0
      ? "Not shared with anyone yet"
      : [`${row.completedCount} of ${total} finished`, watching > 0 ? `${watching} watching` : null].filter(Boolean).join(" · ");
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: withSpring(expanded ? "180deg" : "0deg", springs.standard) }],
  }));
  const isDone = (r: RecipientRow) => row.playableCount > 0 && r.watched >= row.playableCount;
  const finished = row.recipients.filter(isDone);
  const shown = showFinished ? row.recipients : row.recipients.filter((r) => !isDone(r));
  const hairline = { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator };

  return (
    <Card>
      <Tappable
        scaleTo={1}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${row.playlist.name}. ${reach ? `${reach}. ` : ""}${meta}. ${progress}`}
        accessibilityHint={expanded ? "Hides who it was shared with" : "Shows who it was shared with"}
        onPress={onToggle}
        className={({ pressed }) => cn("px-4 pb-3.5 pt-3", pressed && "bg-fill-1")}
      >
        <View className="flex-row items-start gap-3">
          <View className="min-w-0 flex-1">
            {reach ? (
              <Text variant="footnote" numberOfLines={largeText ? 2 : 1} className="text-muted-foreground">
                {reach}
              </Text>
            ) : null}
            <Text variant="headline" numberOfLines={largeText ? 3 : 2}>
              {row.playlist.name}
            </Text>
            <Text variant="subheadline" nums numberOfLines={largeText ? undefined : 1} className="text-muted-foreground">
              {meta}
            </Text>
          </View>
          <Animated.View style={[chevronStyle, { marginTop: 2 }]}>
            <Icon name="chevronDown" size={16} strokeWidth={2} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
          </Animated.View>
        </View>

        {total > 0 ? (
          <View className={cn("mt-3", largeText ? "gap-1.5" : "flex-row items-center gap-3")}>
            <WatchBar done={row.completedCount} started={row.startedCount} total={total} className={largeText ? undefined : "flex-1"} />
            <Text variant="footnote" nums className="text-muted-foreground">
              {progress}
            </Text>
          </View>
        ) : (
          <Text variant="footnote" className="mt-2 text-muted-foreground">
            {progress}
          </Text>
        )}

        {row.uploadingCount > 0 && (
          <View className="mt-2 flex-row items-start gap-1.5">
            <Icon name="warning" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
            <Text variant="footnote" className="shrink text-muted-foreground">
              {row.uploadingCount === 1
                ? "1 clip isn't uploaded, so recipients can't see it"
                : `${row.uploadingCount} clips aren't uploaded, so recipients can't see them`}
            </Text>
          </View>
        )}
      </Tappable>

      {expanded && (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <View style={hairline} />
          {total === 0 ? (
            <Text variant="subheadline" className="px-4 py-3 text-muted-foreground">
              No recipients yet. Share this playlist with a team or a player.
            </Text>
          ) : (
            <View className="pt-1">
              {shown.map((r, i) => {
                const done = isDone(r);
                const active = relativeTime(r.lastActivity ?? undefined);
                const state = remindState.get(`${row.playlist.id}:${r.userId}`);
                return (
                  <View key={r.userId}>
                    {i > 0 && <View style={[hairline, { marginLeft: 56 }]} />}
                    <View className="min-h-12 flex-row items-center gap-3 px-4 py-1.5">
                      <Avatar name={r.name} url={r.avatarUrl ?? undefined} size={28} />
                      <View className="min-w-0 flex-1">
                        <Text variant="subheadline" numberOfLines={1}>
                          {r.name}
                        </Text>
                        <Text variant="footnote" className="text-muted-foreground">
                          {active ? `Active ${active}` : "No activity yet"}
                        </Text>
                      </View>
                      <Text variant="subheadline" nums className="text-muted-foreground">
                        {done ? "Finished" : r.watched > 0 ? `${r.watched} of ${row.playableCount}` : "Not started"}
                      </Text>
                      {done ? (
                        <Icon name="check" size={16} strokeWidth={2} color={colors.mutedForeground} />
                      ) : state === "sent" ? (
                        <Text variant="subheadline" className="text-muted-foreground">
                          Reminded
                        </Text>
                      ) : (
                        <TextButton
                          label="Remind"
                          disabled={state === "sending"}
                          accessibilityLabel={`Remind ${r.name}`}
                          onPress={() => onRemind(r)}
                        />
                      )}
                    </View>
                  </View>
                );
              })}
              {finished.length > 0 && !showFinished && (
                <View className="px-4 pb-1 pt-2" style={{ paddingLeft: 56 }}>
                  <TextButton
                    size="footnote"
                    muted
                    label={finished.length === total ? `All ${total} have finished. Show them` : `${finished.length} ${finished.length === 1 ? "has" : "have"} finished. Show`}
                    onPress={() => setShowFinished(true)}
                  />
                </View>
              )}
            </View>
          )}
          <View style={[hairline, { marginTop: 6 }]} />
          <View className="flex-row items-center justify-between px-4 py-1">
            {behind.length > 0 ? (
              remindingPlaylist ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <TextButton label={`Remind all ${behind.length}`} disabled={remindBusy} onPress={onRemindPlaylist} />
              )
            ) : (
              <View />
            )}
            <TextButton
              label="Watch as a player"
              accessibilityLabel={`Watch ${row.playlist.name} as a player`}
              onPress={() => router.push(`/playlists/${row.playlist.id}`)}
            />
          </View>
        </Animated.View>
      )}
    </Card>
  );
}
