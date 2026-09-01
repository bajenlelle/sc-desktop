import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ListVideo, Plus, Share2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatchRow } from "@/components/match-row";
import { EmptyState } from "@/components/empty-state";
import { GettingStarted } from "@/components/getting-started";
import { NextActionHero } from "@/components/home/next-action-hero";
import { TeamEngagement } from "@/components/home/team-engagement";
import { listMatchesLight, listEventsForMatches, listFolders } from "@/lib/matches-db";
import { listPlaylists, getMySharedPlaylists } from "@/lib/playlists-db";
import { getTeamMembers } from "@/lib/teams-db";
import { listPlaylistClipViews } from "@/lib/clip-views-db";
import { bulkSendReminders } from "@/lib/reminders-bulk";
import { useAuth } from "@/lib/auth-context";
import { folderPath } from "@scoutable/shared/lib/folder-tree";
import { computeHomeHero } from "@scoutable/shared/lib/home-hero";
import {
  buildDashboardRows,
  summarizeDashboard,
  type DashboardRow,
} from "@scoutable/shared/lib/shared-by-me";
import { isClipItem } from "@/types/match";
import type { StoredMatch, Playlist, PlaylistFolder } from "@/types/match";

/** Owner-side playlist tile. Counts clip items (text cards excluded) — the
 * shipped-only playableClips() denominator belongs to recipient surfaces. */
function PlaylistCard({ playlist, folderLabel }: { playlist: Playlist; folderLabel?: string }) {
  const clipCount = playlist.items.filter(isClipItem).length;
  const isShared = (playlist.teamIds?.length ?? 0) > 0 || (playlist.userIds?.length ?? 0) > 0;
  return (
    <Link
      to="/playlists"
      state={{ restore: { playlistId: playlist.id } }}
      className="group block rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md hover:border-border/80"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate font-display text-sm font-bold tracking-wide text-foreground">
          {playlist.name}
        </p>
        {isShared && (
          <span
            title="Shared with your team"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary"
          >
            <Share2 className="h-2.5 w-2.5" />
            Shared
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {clipCount} clip{clipCount !== 1 ? "s" : ""}
      </p>
      {folderLabel && (
        <p className="mt-1 truncate text-xs text-muted-foreground/60">{folderLabel}</p>
      )}
    </Link>
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
      const [ms, ps, fs] = await Promise.all([
        listMatchesLight(activeOrgId ?? undefined, { ownOnly: true }).catch(
          () => [] as StoredMatch[]
        ),
        listPlaylists().catch(() => [] as Playlist[]),
        listFolders().catch(() => [] as PlaylistFolder[]),
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
      setPlaylists(ps);
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
  useEffect(() => {
    if (!isClubSpace) {
      setDashboardRows([]);
      return;
    }
    let cancelled = false;
    getMySharedPlaylists()
      .then(async (shared) => {
        if (cancelled) return;
        if (shared.length === 0) {
          setDashboardRows([]);
          return;
        }
        const teamIds = [...new Set(shared.flatMap((p) => p.teamShares.map((t) => t.teamId)))];
        const [teamMembers, views] = await Promise.all([
          getTeamMembers(teamIds),
          listPlaylistClipViews(shared.map((p) => p.id)),
        ]);
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
  }, [isClubSpace, activeOrgId, user?.id]);

  useEffect(() => {
    const onExported = () => setExportTick((t) => t + 1);
    window.addEventListener("playlist-exported", onExported);
    return () => window.removeEventListener("playlist-exported", onExported);
  }, []);

  const summary = useMemo(() => summarizeDashboard(dashboardRows), [dashboardRows]);

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
      behindCount: summary.behind,
      hasExported: localStorage.getItem("scoutable_has_exported") === "1",
    });
  }, [matches, playlists, isClubSpace, dashboardRows, summary.behind, exportTick]);

  async function handleRemindAll() {
    if (remindingAll || summary.behindTargets.length === 0) return;
    setRemindingAll(true);
    try {
      await bulkSendReminders(summary.behindTargets);
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

  return (
    <div className="p-6">
      <div className="space-y-8">
        {/* Header + always-available quick actions — the veteran's CTA. */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Home</h1>
            {playerClub && (
              <p className="mt-0.5 text-xs text-muted-foreground">
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
          </div>
          <div className="flex items-center gap-2">
            {/* Squads change every season, so inviting shouldn't require
                finding org settings — this opens the invite modal there. */}
            {activeOrgCanManage && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => navigate("/organization", { state: { invite: true } })}
              >
                <UserPlus className="h-4 w-4" />
                Invite players
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={goNewPlaylist}>
              <ListVideo className="h-4 w-4" />
              New playlist
            </Button>
            <Link to="/upload">
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Import game
              </Button>
            </Link>
          </div>
        </div>

        {!loading && <GettingStarted matches={matches} playlists={playlists} />}

        {/* One next action at every lifecycle stage — suppressed while the
            checklist is up (they'd say the same thing twice). */}
        {!loading && !showChecklist && (
          <NextActionHero
            hero={hero}
            playerVoice={playerVoice}
            onRemindAll={handleRemindAll}
            remindingAll={remindingAll}
          />
        )}

        {isClubSpace && (
          <TeamEngagement summary={summary} onRemindAll={handleRemindAll} remindingAll={remindingAll} />
        )}

        {/* Playlists */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Playlists
              {!loading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · {playlists.length}
                </span>
              )}
            </h2>
            <Link to="/playlists">
              <Button variant="ghost" size="sm" className="text-primary">
                View all
              </Button>
            </Link>
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : noPlaylists ? (
            <EmptyState
              title="No playlists yet"
              body="Create a playlist to start organizing clips for scouting or analysis."
              action={<Button onClick={goNewPlaylist}>New playlist</Button>}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {recentPlaylists.map((playlist) => {
                const label = playlist.folderId
                  ? folderPath(folders, playlist.folderId).join(" / ")
                  : undefined;
                return (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    folderLabel={label || undefined}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Recent imports */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recent imports</h2>
            <Link to="/matches">
              <Button variant="ghost" size="sm" className="text-primary">
                View all
              </Button>
            </Link>
          </div>

          {loading ? (
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : noGames ? (
            <EmptyState
              title="No games yet"
              body="Import a game to start building playlists."
              action={
                <Link to="/upload">
                  <Button>Import game</Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border divide-y divide-border">
              {recentMatches.map((match) => (
                <MatchRow key={match.id} match={match} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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
