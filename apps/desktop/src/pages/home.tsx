import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ChevronRight, Film, ListVideo, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroupedList, GroupHeader } from "@/components/ui/group";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { MatchRow } from "@/components/match-row";
import { EmptyState } from "@/components/empty-state";
import { GettingStarted } from "@/components/getting-started";
import { NextActionHero } from "@/components/home/next-action-hero";
import { TeamEngagement } from "@/components/home/team-engagement";
import { HomeReports } from "@/components/home/home-reports";
import { listMatchesLight, listEventsForMatches, listFolders } from "@/lib/matches-db";
import { listOwnPlaylistsAndShared } from "@/lib/playlists-db";
import type { SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
import { getTeamMembers } from "@/lib/teams-db";
import { listPlaylistClipViews } from "@/lib/clip-views-db";
import { bulkSendReminders } from "@/lib/reminders-bulk";
import { getHasExported } from "@/lib/prefs";
import { useAuth } from "@/lib/auth-context";
import { folderPath } from "@scoutable/shared/lib/folder-tree";
import { computeHomeHero } from "@scoutable/shared/lib/home-hero";
import {
  buildDashboardRows,
  summarizeDashboard,
  latestBehindPlaylist,
  type DashboardRow,
} from "@scoutable/shared/lib/shared-by-me";
import { isClipItem } from "@/types/match";
import type { StoredMatch, Playlist, PlaylistFolder } from "@/types/match";

/** Owner-side playlist row. Counts clip items (text cards excluded) — the
 * shipped-only playableClips() denominator belongs to recipient surfaces. */
function PlaylistRow({ playlist, folderLabel }: { playlist: Playlist; folderLabel?: string }) {
  const clipCount = playlist.items.filter(isClipItem).length;
  const isShared = (playlist.teamIds?.length ?? 0) > 0 || (playlist.userIds?.length ?? 0) > 0;
  return (
    <Link
      to="/playlists"
      state={{ restore: { playlistId: playlist.id } }}
      className="group flex min-h-11 items-center gap-3 px-4 py-2 outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
    >
      <ListVideo className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{playlist.name}</span>
        <span className="block truncate text-subheadline nums text-muted-foreground">
          {clipCount} clip{clipCount !== 1 ? "s" : ""}
          {folderLabel ? ` · ${folderLabel}` : ""}
        </span>
      </span>
      {isShared && (
        <span title="Shared with your team" className="shrink-0 rounded-full bg-fill-2 px-2 py-px text-caption text-muted-foreground">
          Shared
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
    </Link>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <GroupedList>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-2">
          <div className="size-4 animate-pulse rounded bg-fill-3" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 animate-pulse rounded bg-fill-3" />
            <div className="h-2.5 w-1/5 animate-pulse rounded bg-fill-2" />
          </div>
        </div>
      ))}
    </GroupedList>
  );
}

const RECENT_MATCH_COUNT = 3;
const PLAYLIST_TILE_COUNT = 6;

function CoachHomePage() {
  const navigate = useNavigate();
  const { user, profile, activeOrgId, activeOrgIsPersonal, activeOrgCanManage, myOrgs, setActiveOrg } =
    useAuth();
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  /** The shared subset of `playlists`, with share timestamps: the engagement dashboard's base. Null until read. */
  const [shared, setShared] = useState<SharedPlaylist[] | null>(null);
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
  const [dashboardRows, setDashboardRows] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [remindingAll, setRemindingAll] = useState(false);
  // Bumped by the playlist-exported event so the hero advances past "export".
  const [exportTick, setExportTick] = useState(0);

  const showChecklist = profile?.onboardingChecklistDismissedAt == null;
  const isClubSpace = !activeOrgIsPersonal;

  function goNewPlaylist() {
    navigate("/playlists", { state: { createNew: true } });
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Light shells + events for only the rows we show — listMatches would
      // join every event of every game just to render three counts.
      const [ms, own, fs] = await Promise.all([
        listMatchesLight(activeOrgId ?? undefined, { ownOnly: true }).catch(
          () => [] as StoredMatch[]
        ),
        // One read for the tiles and the engagement dashboard's shared subset.
        listOwnPlaylistsAndShared(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }).catch(
          () => ({ playlists: [] as Playlist[], shared: [] as SharedPlaylist[] })
        ),
        listFolders(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }).catch(() => [] as PlaylistFolder[]),
      ]);
      if (cancelled) return;
      const recent = ms.slice(0, RECENT_MATCH_COUNT);
      const events = await listEventsForMatches(recent.map((m) => m.id)).catch(
        () => ({}) as Record<string, never[]>
      );
      if (cancelled) return;
      setMatches(
        ms.map((m, i) => (i < RECENT_MATCH_COUNT ? { ...m, events: events[m.id] ?? [] } : m))
      );
      setPlaylists(own.playlists);
      setShared(own.shared);
      setFolders(fs);
      setLoading(false);
    };
    load();
    // The sample game may be seeded moments after first render; imports and
    // deletions elsewhere dispatch matches-changed.
    window.addEventListener("demo-seeded", load);
    window.addEventListener("matches-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("demo-seeded", load);
      window.removeEventListener("matches-changed", load);
    };
  }, [activeOrgId]);

  // Shared-by-me engagement (club coaches only). Name maps are omitted on
  // purpose — the strip and hero only need counts and remind targets.
  // The shared playlists come with the page's own read above.
  useEffect(() => {
    if (!isClubSpace || !shared || shared.length === 0) {
      setDashboardRows([]);
      return;
    }
    let cancelled = false;
    const teamIds = [...new Set(shared.flatMap((p) => p.teamShares.map((t) => t.teamId)))];
    Promise.all([getTeamMembers(teamIds), listPlaylistClipViews(shared.map((p) => p.id))])
      .then(([teamMembers, views]) => {
        if (cancelled) return;
        setDashboardRows(
          buildDashboardRows({
            shared,
            teamMembers,
            views,
            memberMap: new Map(),
            teamMap: new Map(),
            currentUserId: user?.id ?? null,
          })
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isClubSpace, shared, user?.id]);

  useEffect(() => {
    const onExported = () => setExportTick((t) => t + 1);
    window.addEventListener("playlist-exported", onExported);
    return () => window.removeEventListener("playlist-exported", onExported);
  }, []);

  const summary = useMemo(() => summarizeDashboard(dashboardRows), [dashboardRows]);
  // The hero's remind scope: the newest shared playlist with stragglers.
  // Reminding is playlist-scoped by design — see latestBehindPlaylist.
  const latestBehind = useMemo(() => latestBehindPlaylist(dashboardRows), [dashboardRows]);

  const hero = useMemo(() => {
    void exportTick; // hero depends on the localStorage flag below
    return computeHomeHero({
      ownGameCount: matches.filter((m) => !m.isDemo).length,
      demoMatchId: matches.find((m) => m.isDemo)?.id ?? null,
      playlists: playlists.map((p) => ({
        id: p.id,
        name: p.name,
        clipCount: p.items.filter(isClipItem).length,
      })),
      isClubSpace,
      hasSharedAny: dashboardRows.length > 0,
      latestBehind: latestBehind
        ? {
            playlistId: latestBehind.playlistId,
            playlistName: latestBehind.playlistName,
            behindCount: latestBehind.behindCount,
          }
        : null,
      hasExported: getHasExported(user?.id),
    });
  }, [matches, playlists, isClubSpace, dashboardRows, latestBehind, exportTick]);

  async function handleRemindLatest() {
    if (remindingAll || !latestBehind || latestBehind.targets.length === 0) return;
    setRemindingAll(true);
    try {
      await bulkSendReminders(latestBehind.targets);
    } finally {
      setRemindingAll(false);
    }
  }

  const recentMatches = matches.slice(0, RECENT_MATCH_COUNT);
  const recentPlaylists = playlists.slice(0, PLAYLIST_TILE_COUNT);
  const noGames = !loading && matches.length === 0;
  const noPlaylists = !loading && playlists.length === 0;

  // Player voice only in the personal space — same rule as GettingStarted:
  // in a club space the membership role decides the copy.
  const playerVoice = activeOrgIsPersonal && profile?.declaredRole === "player";
  // Club players in their personal space get the road back: coach shares
  // live in the club space, one click away. Users with no club see nothing.
  const playerClub = activeOrgIsPersonal
    ? (myOrgs.find((o) => !o.isPersonal && o.role === "player") ?? null)
    : null;

  // Squads change every season, so inviting shouldn't require finding org
  // settings — this opens the invite modal there.
  const invite = activeOrgCanManage
    ? () => navigate("/organization", { state: { invite: true, inviteRole: "player" } })
    : undefined;

  return (
    <Page>
      <Toolbar
        title="Home"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={goNewPlaylist}>
              <ListVideo />
              New playlist
            </Button>
            <Button size="sm" asChild>
              <Link to="/upload">
                <Plus />
                Import game
              </Link>
            </Button>
          </>
        }
      />
      <PageContent width="wide">
        <div className="space-y-8">
          {playerClub && (
            <p className="text-sm text-muted-foreground">
              Playlists your coach shares live in the {playerClub.orgName} space.{" "}
              <button
                type="button"
                onClick={() => setActiveOrg(playerClub.orgId)}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Open {playerClub.orgName}
              </button>
            </p>
          )}

          {!loading && <GettingStarted matches={matches} playlists={playlists} />}

          {/* One next action at every lifecycle stage — suppressed while the
              checklist is up (they'd say the same thing twice). */}
          {!loading && !showChecklist && (
            <NextActionHero
              hero={hero}
              playerVoice={playerVoice}
              onRemind={handleRemindLatest}
              reminding={remindingAll}
            />
          )}

          {isClubSpace && <TeamEngagement summary={summary} onInvite={invite} />}

          {!loading && <HomeReports />}

          <section>
            <GroupHeader
              title={
                <>
                  Playlists
                  {!loading && (
                    <span className="ml-1.5 font-normal text-muted-foreground nums">{playlists.length}</span>
                  )}
                </>
              }
              action={
                <Link to="/playlists" className="text-sm text-primary hover:underline">
                  View all
                </Link>
              }
            />
            {loading ? (
              <SkeletonRows count={3} />
            ) : noPlaylists ? (
              <GroupedList>
                <EmptyState
                  icon={<ListVideo />}
                  title="No playlists yet"
                  body="Create a playlist to start organizing clips for scouting or analysis."
                  action={<Button onClick={goNewPlaylist}>New playlist</Button>}
                />
              </GroupedList>
            ) : (
              <GroupedList>
                {recentPlaylists.map((playlist) => {
                  const label = playlist.folderId
                    ? folderPath(folders, playlist.folderId).join(" / ")
                    : undefined;
                  return (
                    <PlaylistRow key={playlist.id} playlist={playlist} folderLabel={label || undefined} />
                  );
                })}
              </GroupedList>
            )}
          </section>

          <section>
            <GroupHeader
              title="Recent imports"
              action={
                <Link to="/matches" className="text-sm text-primary hover:underline">
                  View all
                </Link>
              }
            />
            {loading ? (
              <SkeletonRows count={3} />
            ) : noGames ? (
              <GroupedList>
                <EmptyState
                  icon={<Film />}
                  title="No games yet"
                  body="Import a game to start building playlists."
                  action={
                    <Button asChild>
                      <Link to="/upload">Import game</Link>
                    </Button>
                  }
                />
              </GroupedList>
            ) : (
              <GroupedList>
                {recentMatches.map((match) => (
                  <MatchRow key={match.id} match={match} />
                ))}
              </GroupedList>
            )}
          </section>
        </div>
      </PageContent>
    </Page>
  );
}

export function HomePage() {
  const { profileLoading, activeOrgIsPersonal, activeOrgRole } = useAuth();
  if (profileLoading) return null;
  // The membership role in the ACTIVE space decides, not the vestigial
  // profiles.role: club players belong on their playlist feed, but in their
  // personal space everyone is a builder (players make their own tapes).
  if (!activeOrgIsPersonal && activeOrgRole === "player") {
    return <Navigate to="/my-playlists" replace />;
  }
  return <CoachHomePage />;
}
