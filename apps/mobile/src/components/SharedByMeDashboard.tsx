import { useEffect, useMemo, useState, type RefObject } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { getMySharedPlaylists, type SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
import { getTeamMembers, type TeamMemberRef } from "@scoutable/shared/lib/teams-db";
import { listPlaylistClipViews, type PlaylistClipView } from "@scoutable/shared/lib/clip-views-db";
import { sendPlaylistReminder } from "@scoutable/shared/lib/reminders-db";
import { shareTimeSections } from "@scoutable/shared/lib/share-time";
import {
  buildDashboardRows,
  teamFilterOptions,
  filterByTeamAndQuery,
  dashboardCounts,
  visibleDashboardRows,
  behindRecipients,
  dashboardScopeLabel,
  type DashboardRow,
  type DashboardSort,
  type RecipientRow,
} from "@scoutable/shared/lib/shared-by-me";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { relativeTime } from "@/lib/format";
import { successHaptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme-context";
import { useLargeText } from "@/lib/a11y";
import { RecipientsSheet, progressLine } from "@/components/RecipientsSheet";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { NoticeRow, TextButton } from "@/components/ui/Row";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
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
 * The coach's side of sharing, as Claude's Artifacts list: one card per
 * shared playlist on the grouped floor, by week and month while sorted by
 * Recently shared. A card's tile carries how many finished over the web's
 * watch bar; beside it the name, where it went and when. Tapping a card
 * opens its recipients in a sheet, with Remind, Remind all and Watch as a
 * player. Status, team and sort live in the title bar's pop-up menu (its
 * counts replace the old roll-up line). Renders inside the screen's scroll
 * view; the search is the screen's floating capsule.
 */
export function SharedByMeDashboard({
  query,
  refreshNonce,
  filters,
  onFiltersChange,
  onClearFilters,
  sheetOpen,
  onCloseSheet,
  menuAnchor,
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
  /** The filter button the menu opens from. */
  menuAnchor: RefObject<View | null>;
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
  // The playlist whose recipients sheet is up (kept while it slides away).
  const [sheetRowId, setSheetRowId] = useState<string | null>(null);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
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

  // The filter button's pop-up menu: what to show, which team, how to sort.
  const sheet = (
    <PopoverMenu
      visible={sheetOpen}
      onClose={onCloseSheet}
      anchorRef={menuAnchor}
      accessibilityLabel="Filters"
      groups={[
        {
          key: "show",
          items: [
            { key: "all", label: "All", icon: "send", count: counts.all, checked: filters.status === "all", onSelect: () => setStatus("all") },
            { key: "attention", label: "Not finished", icon: "circleDashed", count: counts.attention, checked: filters.status === "attention", onSelect: () => setStatus("attention") },
            { key: "done", label: "Finished", icon: "checkCircle", count: counts.done, checked: filters.status === "done", onSelect: () => setStatus("done") },
            ...(uploadIssues > 0
              ? [{ key: "issues", label: "Upload issues", icon: "warning" as const, count: uploadIssues, checked: filters.status === "issues", onSelect: () => setStatus("issues") }]
              : []),
          ],
        },
        ...(teamOptions.length > 2
          ? [
              {
                key: "team",
                items: teamOptions.map((o) => ({
                  key: o.value,
                  label: o.label,
                  icon: "team" as const,
                  checked: filters.team === o.value,
                  onSelect: () => onFiltersChange({ ...filters, team: o.value }),
                })),
              },
            ]
          : []),
        {
          key: "sort",
          items: (
            [
              { value: "recent", label: "Recently shared", icon: "clock" },
              { value: "least", label: "Least watched first", icon: "sortLeast" },
              { value: "name", label: "Name", icon: "sortName" },
            ] as const
          ).map((o) => ({
            key: o.value,
            label: o.label,
            icon: o.icon,
            checked: filters.sort === o.value,
            onSelect: () => onFiltersChange({ ...filters, sort: o.value as DashboardSort }),
          })),
        },
      ]}
    />
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

  // Newest first by week and month, as the feed; other sorts are one list.
  const sections =
    filters.sort === "recent"
      ? shareTimeSections(visibleRows, (r) => r.newestSharedAt)
      : [{ key: "all", title: "", items: visibleRows }];
  const sheetRow = rows.find((r) => r.playlist.id === sheetRowId) ?? null;

  return (
    <View>
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
        sections.map((sec, i) => (
          <View key={sec.key}>
            {sec.title ? (
              <Text variant="subheadline" accessibilityRole="header" className={cn("px-4 pb-2 text-muted-foreground", i === 0 ? "pt-1" : "pt-6")}>
                {sec.title}
              </Text>
            ) : null}
            <View className="gap-3">
              {sec.items.map((row) => (
                <PlaylistCard
                  key={row.playlist.id}
                  row={row}
                  onOpen={() => {
                    setSheetRowId(row.playlist.id);
                    setRecipientsOpen(true);
                  }}
                />
              ))}
            </View>
          </View>
        ))
      )}
      {sheet}
      <RecipientsSheet
        row={sheetRow}
        visible={recipientsOpen}
        onClose={() => setRecipientsOpen(false)}
        remindState={remindState}
        onRemind={(r) => sheetRow && handleRemind(sheetRow.playlist.id, r)}
        onRemindPlaylist={() => sheetRow && handleRemindPlaylist(sheetRow)}
        remindingPlaylist={!!sheetRow && remindingPlaylistId === sheetRow.playlist.id}
        remindBusy={remindingPlaylistId !== null}
      />
    </View>
  );
}

const TILE_W = 112;
const TILE_H = 76;

/**
 * One shared playlist as Claude's Artifacts card: a tile on the left with
 * the one number that matters (how many finished, over the watch bar), then
 * the name, where it went and when. Tapping opens the recipients sheet.
 */
function PlaylistCard({ row, onOpen }: { row: DashboardRow; onOpen: () => void }) {
  const colors = useThemeColors();
  const largeText = useLargeText();
  const total = row.recipients.length;
  const reach = dashboardScopeLabel(row);
  const when = relativeTime(row.newestSharedAt ?? undefined);
  const meta = [when ? `Shared ${when}` : null, `${row.playableCount} clip${row.playableCount === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");
  const progress = progressLine(row);

  return (
    <Card>
      <Tappable
        scaleTo={1}
        accessibilityRole="button"
        accessibilityLabel={`${row.playlist.name}. ${reach ? `${reach}. ` : ""}${meta}. ${progress}`}
        accessibilityHint="Shows who it was shared with"
        onPress={onOpen}
        className={({ pressed }) => cn("flex-row items-center gap-3.5 p-3", pressed && "bg-fill-1")}
      >
        <View
          accessible={false}
          className="items-center justify-center overflow-hidden rounded-window bg-fill-2"
          style={{ width: TILE_W, height: TILE_H }}
        >
          {total > 0 ? (
            <>
              <Text variant="title3" nums maxFontSizeMultiplier={1.3} className="font-semibold">
                {`${row.completedCount}/${total}`}
              </Text>
              <Text variant="footnote" maxFontSizeMultiplier={1.3} className="mb-2.5 text-muted-foreground">
                finished
              </Text>
              <View style={{ position: "absolute", left: 10, right: 10, bottom: 9 }}>
                <WatchBar done={row.completedCount} started={row.startedCount} total={total} />
              </View>
            </>
          ) : (
            <Icon name="send" size={22} color={colors.mutedForeground} />
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text variant="headline" numberOfLines={largeText ? 3 : 2}>
            {row.playlist.name}
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <Icon name={row.teamNames.length > 0 || row.directCount === 0 ? "team" : "person"} size={14} color={colors.mutedForeground} />
            <Text variant="subheadline" numberOfLines={largeText ? 2 : 1} className="shrink text-muted-foreground">
              {reach || "No recipients"}
            </Text>
          </View>
          <Text variant="subheadline" nums numberOfLines={largeText ? undefined : 1} className="text-muted-foreground">
            {meta}
          </Text>
          {row.uploadingCount > 0 && (
            <View className="mt-1 flex-row items-start gap-1.5">
              <Icon name="warning" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
              <Text variant="footnote" className="shrink text-muted-foreground">
                {row.uploadingCount === 1
                  ? "1 clip isn't uploaded, so recipients can't see it"
                  : `${row.uploadingCount} clips aren't uploaded, so recipients can't see them`}
              </Text>
            </View>
          )}
        </View>
      </Tappable>
    </Card>
  );
}
