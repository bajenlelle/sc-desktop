import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Shield } from "lucide-react";
import { teamKeys, type TeamKey } from "@scoutable/shared/lib/team-keys";
import { keyStatOf, teamLibraryGames, teamVideo, type PlaysPick, type PlaysSide } from "@scoutable/shared/lib/team-video";
import type { ShotZone } from "@scoutable/shared/lib/game-shots";
import { TeamShotsSection } from "@/components/team/team-shots-section";
import { useTeamPlays } from "@/lib/use-team-plays";
import { groupNames, teamGameRows, teamNames, type TeamGameRow } from "@scoutable/shared/lib/team-schedule";
import { TeamGamesSection, type ImportPick } from "@/components/team/team-games-section";
import { TeamPlayersSection } from "@/components/team/team-players-section";
import { useTeamPlayers } from "@/lib/use-team-players";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { TeamHeader } from "@/components/team/team-header";
import { TeamKeysSection } from "@/components/team/team-keys-section";
import { TeamProfileSection } from "@/components/team/team-profile-section";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { useLeague } from "@/lib/use-league";
import { useLeagues } from "@/lib/use-leagues";
import { useLibraryGames } from "@/lib/use-library-games";
import { useMyTeamIds } from "@/lib/use-my-team-ids";

/** Where the page was opened from, as the links that open it say (team_page_viewed's `from`). */
export type TeamPageFrom = "teams" | "game" | "search" | "team" | "other";

/**
 * What a link to a team's page carries: where it came from, where Back goes
 * when that isn't Teams, and in Plays what Watch picked and which side.
 */
export interface TeamPageState {
  from?: TeamPageFrom;
  back?: { label: string; path: string };
  pick?: PlaysPick | null;
  side?: PlaysSide;
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="h-4 w-64 animate-pulse rounded bg-fill-3" />
      <div className="h-24 animate-pulse rounded-window bg-fill-1" />
      <div className="h-56 animate-pulse rounded-window bg-fill-1" />
    </div>
  );
}

/**
 * One team's season (docs/teams.md): what stands out, how it plays at both
 * ends, who does what and its games. Season numbers only; the coach's library
 * shows as which games they have.
 */
export function TeamPage() {
  const params = useParams();
  const competitionId = Number(params.competitionId) || null;
  const teamId = Number(params.teamId);
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as TeamPageState;
  const back = state.back ?? { label: "Teams", path: "/teams" };

  const leagues = useLeagues();
  const where_ = useMemo(() => {
    for (const l of leagues) {
      const s = l.seasons.find((x) => x.competitionId === competitionId);
      if (s) return { leagueId: l.id, seasonId: s.id, label: `${l.name} · ${s.label}`, current: l.seasons[0] === s };
    }
    return null;
  }, [leagues, competitionId]);
  const seasonLabel = where_?.label;
  const players = useTeamPlayers(competitionId, teamId, where_?.current ?? false);
  const importPick = useCallback(
    (row: TeamGameRow): ImportPick | null =>
      where_ ? { leagueId: where_.leagueId, seasonId: where_.seasonId, matchId: row.matchId, matchType: row.regular ? "REGULAR" : "FINALS" } : null,
    [where_],
  );

  const { status, payload, fixtures, league, retry } = useLeague(competitionId);
  const library = useLibraryGames();
  const mine = useMyTeamIds(competitionId, leagues);

  const profile = league?.teams.get(teamId) ?? null;
  const name = useMemo(() => teamNames(fixtures).get(teamId)?.name ?? "", [fixtures, teamId]);
  const rows = useMemo(() => (payload ? teamGameRows(fixtures, payload, teamId, new Date()) : []), [fixtures, payload, teamId]);
  const keys = useMemo(() => (profile && league ? teamKeys(profile, league) : null), [profile, league]);
  const group = league?.groups.find((g) => g.group === profile?.group) ?? null;

  // The team's games in the coach's library and their plays, read once per team for both views.
  const teamGames = useMemo(() => teamLibraryGames(rows, library.games), [rows, library.games]);
  const plays = useTeamPlays(teamGames, `${competitionId}:${teamId}`);
  const video = useMemo(() => (plays.status === "ready" && plays.games.length > 0 ? teamVideo(plays.games) : null), [plays.status, plays.games]);

  // Once per open, when the season and the library are in (location.key changes with every visit).
  const location = useLocation();
  const viewedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!profile || !keys || !library.ready || viewedFor.current === location.key) return;
    viewedFor.current = location.key;
    const played = rows.filter((r) => r.status === "played");
    trackEvent("team_page_viewed", {
      league: where_?.leagueId ?? null,
      season: where_?.seasonId ?? null,
      games: played.length,
      library_games: played.filter((r) => library.games.has(r.matchId)).length,
      keys: keys.withBall.length + keys.withoutBall.length,
      own_team: mine.has(teamId),
      from: state.from ?? "other",
    });
  }, [profile, keys, library, rows, location.key, where_, mine, teamId, state.from]);
  const action = useCallback((a: "open_game" | "import" | "open_team" | "show_all_players" | "show_all_games") => trackEvent("team_page_action", { action: a }), []);
  // Watch: Plays with this pick and side; Back still goes where it went.
  const watch = useCallback(
    (pick: PlaysPick | null, side: PlaysSide, a: "watch_all" | "watch_key" | "watch_shots" | "watch_player", extra: Record<string, string> = {}) => {
      trackEvent("team_page_action", { action: a, ...extra });
      navigate(`${location.pathname}?view=plays`, { state: { ...state, pick, side } satisfies TeamPageState });
    },
    [navigate, location.pathname, state],
  );
  const watchKey = useCallback(
    (k: TeamKey) => {
      const s = keyStatOf(k.end, k.metric);
      if (s) watch({ kind: "stat", stat: s.stat, side: s.side }, s.side, "watch_key", { key: `${k.end}.${k.metric}` });
    },
    [watch],
  );
  const where = useMemo(() => {
    if (!league || league.groups.length < 2 || !profile) return null;
    const i = league.groups.findIndex((g) => g.group === profile.group);
    return (profile.group !== null ? groupNames(fixtures).get(profile.group) : undefined) ?? `Group ${i + 1}`;
  }, [league, profile, fixtures]);

  return (
    <Page>
      <Toolbar
        leading={
          <Button variant="ghost" size="sm" className="-ml-1 min-w-0 shrink text-muted-foreground" onClick={() => navigate(back.path)}>
            <ChevronLeft className="shrink-0" />
            <span className="max-w-48 truncate">{back.label}</span>
          </Button>
        }
        title={name || (status === "ready" ? "Team" : "")}
        subtitle={seasonLabel}
      />
      <PageContent width="wide">
        {status === "failed" ? (
          <EmptyState
            title="Couldn't load this team's season."
            body="Check your connection and try again."
            action={
              <Button size="sm" variant="outline" onClick={retry}>
                Try again
              </Button>
            }
          />
        ) : status === "unavailable" ? (
          <EmptyState icon={<Shield />} title="This league has no team statistics." body="Choose another league in Teams." action={<GoToTeams />} />
        ) : status !== "ready" || !league ? (
          <Skeleton />
        ) : !profile ? (
          <EmptyState icon={<Shield />} title="This team isn't in this season." body="It may have played in another league or season." action={<GoToTeams />} />
        ) : (
          <div className="space-y-8">
            <TeamHeader
              profile={profile}
              rows={rows}
              library={library.games}
              mine={mine}
              watchAll={video ? { plays: video.all.with, onWatch: () => watch(null, "with", "watch_all") } : null}
            />
            {keys && <TeamKeysSection keys={keys} where={where} video={video ? { video, onWatch: watchKey } : null} />}
            <TeamProfileSection profile={profile} group={group} where={where} />
            {video && <TeamShotsSection shots={video.shots} onWatch={(zone: ShotZone) => watch({ kind: "zone", zone }, "with", "watch_shots", { zone })} />}
            <TeamPlayersSection
              status={players.status}
              rows={players.rows}
              retry={players.retry}
              onShowAll={() => action("show_all_players")}
              video={video ? { players: video.players, onWatch: (personId, name) => watch({ kind: "player", personId, name }, "with", "watch_player") } : null}
            />
            <TeamGamesSection
              rows={rows}
              competitionId={competitionId!}
              teamName={name || "Team"}
              library={library.games}
              mine={mine}
              importPick={importPick}
              onAction={action}
            />
          </div>
        )}
      </PageContent>
    </Page>
  );
}

function GoToTeams() {
  return (
    <Button size="sm" variant="outline" asChild>
      <Link to="/teams">Go to Teams</Link>
    </Button>
  );
}
