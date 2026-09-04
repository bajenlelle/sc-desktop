import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
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
  type RecipientRow,
} from "@scoutable/shared/lib/shared-by-me";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/Button";
import { usePlaylists } from "@/lib/playlists-store";
import { relativeTime } from "@/lib/format";
import { themeColors } from "@/lib/theme";
import { Avatar } from "@/components/Avatar";
import { ProgressBar } from "@/components/ProgressBar";
import { Select } from "@/components/Select";

/** Search earns its place once the list stops fitting on one screen. */
const SEARCH_THRESHOLD = 10;

/**
 * Done / in progress / not started at a glance — the same tri-state bar the
 * web/desktop dashboards use.
 */
function SegmentedProgress({
  done,
  started,
  total,
  className = "",
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
    <View
      className={`h-1.5 flex-row overflow-hidden rounded-full bg-muted dark:bg-muted-dark ${className}`}
    >
      <View className="h-full bg-primary dark:bg-primary-dark" style={{ width: `${donePct}%` }} />
      <View
        className="h-full bg-primary/40 dark:bg-primary-dark/40"
        style={{ width: `${progressPct}%` }}
      />
    </View>
  );
}

function StatusPill({ done, started }: { done: boolean; started: boolean }) {
  const cls = done
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : started
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : "bg-muted dark:bg-muted-dark text-muted-foreground dark:text-muted-foreground-dark";
  return (
    <Text className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {done ? "Done" : started ? "In progress" : "Not started"}
    </Text>
  );
}

/**
 * The coach's side of sharing — mobile port of the web dashboard's phone
 * layout: summary strip, per-playlist progress cards with expandable
 * recipient rows, and reminder nudges.
 */
export function SharedByMeDashboard() {
  const scheme = useColorScheme();
  const colors = themeColors(scheme);
  const { teamMap, memberMap } = usePlaylists();
  const { user, activeOrg, activeOrgId } = useAuth();
  const currentUserId = user?.id ?? null;

  const [shared, setShared] = useState<SharedPlaylist[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRef[]>([]);
  const [views, setViews] = useState<PlaylistClipView[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "attention" | "done">("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [query, setQuery] = useState("");
  /** key = `${playlistId}:${userId}` — per-recipient nudge lifecycle. */
  const [remindState, setRemindState] = useState<Map<string, "sending" | "sent">>(new Map());
  const [remindingAll, setRemindingAll] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

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

  // Mobile has no "issues" chip — dashboardCounts still returns it, unused.
  const counts = useMemo(() => dashboardCounts(inTeam), [inTeam]);

  // "recent" sort is the newest-first passthrough (mobile has no sort menu).
  const visibleRows = useMemo(
    () => visibleDashboardRows(inTeam, statusFilter, "recent"),
    [inTeam, statusFilter],
  );

  async function handleRemind(playlistId: string, recipient: RecipientRow) {
    const key = `${playlistId}:${recipient.userId}`;
    setRemindState((prev) => new Map(prev).set(key, "sending"));
    try {
      await sendPlaylistReminder(supabase, playlistId, recipient.userId);
      setRemindState((prev) => new Map(prev).set(key, "sent"));
    } catch (e) {
      setRemindState((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      Alert.alert("Couldn't send reminder", (e as Error).message);
    }
  }

  /** Shared by the strip's global Remind all and the per-playlist button. */
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
      return (
        <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Reminded ✓
        </Text>
      );
    }
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => handleRemind(playlistId, recipient)}
        disabled={state === "sending"}
        className="min-h-[32px] flex-row items-center justify-center rounded-md border border-border dark:border-border-dark px-2.5 active:bg-muted dark:active:bg-muted-dark"
      >
        {state === "sending" ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Text className="text-xs font-medium text-muted-foreground dark:text-muted-foreground-dark">
            Remind
          </Text>
        )}
      </Pressable>
    );
  }

  if (shared === null) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (rows.length === 0) {
    // Staff of a club org get pointed at org setup — a brand-new admin's
    // first job is teams and invites (web-only), not sharing playlists.
    const canManageOrg =
      !!activeOrg && !activeOrg.isPersonal && (activeOrg.role === "coach" || activeOrg.role === "admin");
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6 py-16">
        <Text className="text-sm font-medium text-foreground dark:text-foreground-dark">
          You haven&apos;t shared any playlists yet
        </Text>
        <Text className="max-w-xs text-center text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Share one from the desktop playlist editor and you&apos;ll see here who has watched
          what.
        </Text>
        {canManageOrg && (
          <>
            <Text className="max-w-xs text-center text-sm text-muted-foreground dark:text-muted-foreground-dark">
              New club? Create teams and invite coaches and players from the web.
            </Text>
            <Button
              title="Set up your club on the web"
              className="mt-1"
              onPress={() => {
                trackEvent("manage_org_web_clicked");
                WebBrowser.openBrowserAsync("https://app.scoutable.se/organization").catch(() => {});
              }}
            />
          </>
        )}
      </View>
    );
  }

  const chips = [
    { key: "all" as const, label: "All" },
    { key: "attention" as const, label: "Not fully watched" },
    { key: "done" as const, label: "Fully watched" },
  ];

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 py-3">
      {/* Roll-up strip — "who's behind?" answered before any expanding.
          The behind tile doubles as a filter. */}
      <View className="flex-row items-stretch gap-2">
        <View className="flex-1 justify-center rounded-lg border border-border dark:border-border-dark px-3 py-2">
          <Text className="text-lg font-semibold tabular-nums text-foreground dark:text-foreground-dark">
            {summary.playlists}
          </Text>
          <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
            playlists shared
          </Text>
        </View>
        <View className="flex-1 justify-center rounded-lg border border-border dark:border-border-dark px-3 py-2">
          <Text className="text-lg font-semibold tabular-nums text-foreground dark:text-foreground-dark">
            {summary.recipients}
          </Text>
          <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
            players reached
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setStatusFilter("attention")}
          className={`flex-1 justify-center rounded-lg border px-3 py-2 ${
            summary.behind > 0
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-border dark:border-border-dark"
          }`}
        >
          <Text
            className={`text-lg font-semibold tabular-nums ${
              summary.behind > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground dark:text-foreground-dark"
            }`}
          >
            {summary.behind}
          </Text>
          <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {summary.behind === 1 ? "player hasn't finished" : "players haven't finished"}
          </Text>
        </Pressable>
      </View>

      {summary.behind > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={handleRemindAll}
          disabled={remindingAll}
          className="min-h-[40px] flex-row items-center justify-center gap-2 rounded-md bg-amber-500/15 px-3 active:bg-amber-500/25"
        >
          {remindingAll ? (
            <ActivityIndicator size="small" color="#d97706" />
          ) : (
            <Text className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Remind all {summary.behind} player{summary.behind === 1 ? "" : "s"}
            </Text>
          )}
        </Pressable>
      )}

      {rows.length > SEARCH_THRESHOLD && (
        <View className="flex-row items-center gap-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search playlists…"
            placeholderTextColor={colors.mutedForeground}
            className="min-h-[36px] flex-1 rounded-md border border-border dark:border-border-dark px-3 text-sm text-foreground dark:text-foreground-dark"
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery("")}
              className="min-h-[36px] min-w-[36px] items-center justify-center"
            >
              <Text className="text-base text-muted-foreground dark:text-muted-foreground-dark">
                ✕
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Filter bar — same visual language as the player feed's chip bar. */}
      <View className="flex-row flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const active = statusFilter === c.key;
          return (
            <Pressable
              key={c.key}
              accessibilityRole="button"
              onPress={() => setStatusFilter(c.key)}
              className={`min-h-[32px] flex-row items-center gap-1.5 rounded-full px-3 ${
                active ? "bg-primary dark:bg-primary-dark" : "bg-muted dark:bg-muted-dark"
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  active
                    ? "text-primary-foreground dark:text-primary-foreground-dark"
                    : "text-muted-foreground dark:text-muted-foreground-dark"
                }`}
              >
                {c.label} {counts[c.key]}
              </Text>
            </Pressable>
          );
        })}
        {teamOptions.length > 2 && (
          <View className="ml-auto">
            <Select options={teamOptions} value={teamFilter} onChange={setTeamFilter} />
          </View>
        )}
      </View>

      {visibleRows.length === 0 && (
        <View className="items-center gap-2 px-6 py-16">
          <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Nothing matches these filters.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setStatusFilter("all");
              setTeamFilter("all");
              setQuery("");
            }}
            className="min-h-[36px] justify-center"
          >
            <Text className="text-sm font-medium text-primary dark:text-primary-dark">
              Clear filters
            </Text>
          </Pressable>
        </View>
      )}

      {visibleRows.map((row) => {
        const expanded = expandedId === row.playlist.id;
        const total = row.recipients.length;
        // Who on THIS playlist still has clips left — powers the per-playlist nudge.
        const behindCount = behindRecipients(row).length;
        const reach = [
          ...row.teamNames,
          row.directCount > 0 ? `${row.directCount} member${row.directCount === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const when = relativeTime(row.newestSharedAt ?? undefined);

        return (
          <View
            key={row.playlist.id}
            className="rounded-xl border border-border dark:border-border-dark"
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpandedId(expanded ? null : row.playlist.id)}
              className="gap-3 p-4"
            >
              <View className="flex-row items-start gap-2">
                <Text className="mt-0.5 w-4 text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  {expanded ? "▾" : "▸"}
                </Text>
                <View className="min-w-0 flex-1">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/playlists/${row.playlist.id}`)}
                  >
                    <Text
                      numberOfLines={2}
                      className="text-sm font-semibold text-foreground dark:text-foreground-dark"
                    >
                      {row.playlist.name}
                    </Text>
                  </Pressable>
                  <Text
                    numberOfLines={1}
                    className="mt-0.5 text-xs text-muted-foreground dark:text-muted-foreground-dark"
                  >
                    {reach || "No recipients"}
                    {when ? ` · shared ${when}` : ""}
                    {` · ${row.playableCount} clip${row.playableCount === 1 ? "" : "s"}`}
                  </Text>
                  {row.uploadingCount > 0 && (
                    <Text className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                      {row.uploadingCount} clip{row.uploadingCount === 1 ? "" : "s"} not uploaded —
                      upload from the desktop app.
                    </Text>
                  )}
                </View>
              </View>

              <View className="flex-row items-center gap-2 pl-6">
                <SegmentedProgress
                  done={row.completedCount}
                  started={row.startedCount}
                  total={total}
                  className="flex-1"
                />
                <Text className="shrink-0 text-xs tabular-nums text-muted-foreground dark:text-muted-foreground-dark">
                  {total > 0 ? `${row.completedCount} done of ${total}` : "No recipients"}
                </Text>
                {behindCount > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleRemindPlaylist(row)}
                    disabled={remindingPlaylistId !== null}
                    className="min-h-[32px] flex-row items-center justify-center rounded-md bg-amber-500/15 px-2.5 active:bg-amber-500/25"
                  >
                    {remindingPlaylistId === row.playlist.id ? (
                      <ActivityIndicator size="small" color="#d97706" />
                    ) : (
                      <Text className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        Remind {behindCount}
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
            </Pressable>

            {expanded && (
              <View className="border-t border-border dark:border-border-dark">
                {row.recipients.map((r) => {
                  const done = row.playableCount > 0 && r.watched >= row.playableCount;
                  const started = r.watched > 0;
                  const rpct =
                    row.playableCount > 0 ? (r.watched / row.playableCount) * 100 : 0;
                  const active = relativeTime(r.lastActivity ?? undefined);
                  return (
                    <View
                      key={r.userId}
                      className="gap-2 border-b border-border/60 dark:border-border-dark/60 px-4 py-3"
                    >
                      <View className="flex-row items-center justify-between gap-2">
                        <View className="min-w-0 flex-1 flex-row items-center gap-2">
                          <Avatar name={r.name} url={r.avatarUrl ?? undefined} size={24} />
                          <Text
                            numberOfLines={1}
                            className="flex-1 text-sm text-foreground dark:text-foreground-dark"
                          >
                            {r.name}
                          </Text>
                        </View>
                        <StatusPill done={done} started={started} />
                      </View>
                      <View className="flex-row items-center gap-2">
                        <ProgressBar value={rpct} className="flex-1" />
                        <Text className="text-xs tabular-nums text-muted-foreground dark:text-muted-foreground-dark">
                          {r.watched}/{row.playableCount}
                        </Text>
                      </View>
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
                          {active ? `Active ${active}` : "No activity"}
                        </Text>
                        {!done && <RemindButton playlistId={row.playlist.id} recipient={r} />}
                      </View>
                    </View>
                  );
                })}
                {row.recipients.length === 0 && (
                  <Text className="px-4 py-4 text-center text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    No recipients yet — share this playlist with a team or player.
                  </Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
