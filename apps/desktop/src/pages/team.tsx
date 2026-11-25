import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Shield } from "lucide-react";
import { teamKeys, type TeamKey } from "@scoutable/shared/lib/team-keys";
import { flipPick, keyStatOf, teamLibraryGames, teamVideo, type PlaysPick, type PlaysSide } from "@scoutable/shared/lib/team-video";
import { TeamPlaysView, type LatestImport } from "@/components/team/team-plays-view";
import { TeamViewSwitch, type TeamView } from "@/components/team/team-view-switch";
import { playedDay } from "@/components/team/dates";
import { useClipLabels } from "@/lib/use-clip-labels";
import { useAuth } from "@/lib/auth-context";
import { CollectControl } from "@/components/game/collect-control";
import { useCollect, type CollectScope } from "@/components/game/use-collect";
import { cn } from "@/lib/utils";
import type { ShotZone } from "@scoutable/shared/lib/game-shots";
import { TeamShotsSection } from "@/components/team/team-shots-section";
import { useTeamPlays } from "@/lib/use-team-plays";
import { teamGameRows, teamGroupLabel, teamNames, type TeamGameRow } from "@scoutable/shared/lib/team-schedule";
import { TeamGamesSection, type ImportPick } from "@/components/team/team-games-section";
import { TeamPlayersSection } from "@/components/team/team-players-section";
import { useTeamPlayers } from "@/lib/use-team-players";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { usePageTitle } from "@/lib/nav-history";
import { TeamHeader } from "@/components/team/team-header";
import { TeamKeysSection } from "@/components/team/team-keys-section";
import { TeamProfileSection } from "@/components/team/team-profile-section";
import { Button } from "@/components/ui/button";
import { teamTabId } from "@scoutable/shared/lib/team-tabs";
import { trackEvent } from "@/lib/analytics";
import { gameTabsScope } from "@/lib/game-tabs";
import { rememberTeamLeft, rememberTeamTab } from "@/lib/team-tabs";
import { useLeague } from "@/lib/use-league";
import { useLeagues } from "@/lib/use-leagues";
import { useLibraryGames } from "@/lib/use-library-games";
import { useMyTeamIds } from "@/lib/use-my-team-ids";
import { nextMeeting } from "@/lib/team-report";
import { useTeamReport } from "@/lib/use-team-report";
import { TeamReportToolbarButton } from "@/components/report/team-report-button";

/** Where the page was opened from, as the links that open it say (team_page_viewed's `from`). */
export type TeamPageFrom = "teams" | "game" | "search" | "team" | "open_teams" | "other";

/**
 * What a link to a team's page carries: where it came from, and in Plays what
 * Watch picked and which side. Back is the page before (lib/nav-history.ts).
 */
export interface TeamPageState {
  from?: TeamPageFrom;
  pick?: PlaysPick | null;
  side?: PlaysSide;
  /** How Plays was opened, for team_plays_viewed. */
  playsFrom?: PlaysFrom;
}

type PlaysFrom = "switch" | "watch_all" | "key" | "shots" | "player";
const PLAYS_FROM: Record<"watch_all" | "watch_key" | "watch_shots" | "watch_player", PlaysFrom> = {
  watch_all: "watch_all",
  watch_key: "key",
  watch_shots: "shots",
  watch_player: "player",
};

/** Where a team goes back to when nothing was before it (the app started on it, a reload). */
const TEAMS_FALLBACK = { label: "Teams", path: "/teams" };

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
  // The name the next page's back button gives this team.
  usePageTitle(name);
  const rows = useMemo(() => (payload ? teamGameRows(fixtures, payload, teamId, new Date()) : []), [fixtures, payload, teamId]);
  const keys = useMemo(() => (profile && league ? teamKeys(profile, league) : null), [profile, league]);
  const group = league?.groups.find((g) => g.group === profile?.group) ?? null;

  // The team's games in the coach's library and their plays, read once per team for both views.
  const teamGames = useMemo(() => teamLibraryGames(rows, library.games), [rows, library.games]);
  const plays = useTeamPlays(teamGames, `${competitionId}:${teamId}`, library.ready);
  const video = useMemo(() => (plays.status === "ready" && plays.games.length > 0 ? teamVideo(plays.games) : null), [plays.status, plays.games]);

  // Once per open, when the season and the library are in. An open is a mount: every route is keyed by its path
  // (App.tsx), while Season | Plays, the side and the pick change only the search and the router state.
  const location = useLocation();
  const viewed = useRef(false);
  useEffect(() => {
    if (!profile || !keys || !library.ready || viewed.current) return;
    viewed.current = true;
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
  }, [profile, keys, library, rows, where_, mine, teamId, state.from]);
  const action = useCallback((a: "open_game" | "import" | "open_team" | "show_all_players" | "show_all_games") => trackEvent("team_page_action", { action: a }), []);
  // Watch: Plays with this pick and side, in place of Season (as the switch does): Back leaves the team.
  const watch = useCallback(
    (pick: PlaysPick | null, side: PlaysSide, a: "watch_all" | "watch_key" | "watch_shots" | "watch_player", extra: Record<string, string> = {}) => {
      trackEvent("team_page_action", { action: a, ...extra });
      navigate(`${location.pathname}?view=plays`, { replace: true, state: { ...state, pick, side, playsFrom: PLAYS_FROM[a] } satisfies TeamPageState });
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
  // Season | Plays: the view is in the URL; what Plays shows (side, pick) rides in the router state, so a reload keeps it.
  const [searchParams] = useSearchParams();
  const view: TeamView = searchParams.get("view") === "plays" ? "plays" : "season";
  const side: PlaysSide = state.side ?? "with";
  const pick = state.pick ?? null;
  const setView = (v: TeamView) =>
    navigate(`${location.pathname}${v === "plays" ? "?view=plays" : ""}`, { replace: true, state: { ...state, playsFrom: v === "plays" ? "switch" : state.playsFrom } satisfies TeamPageState });
  const setPlays = (next: Pick<TeamPageState, "side" | "pick">) =>
    navigate(`${location.pathname}?view=plays`, { replace: true, state: { ...state, ...next } satisfies TeamPageState });
  // Plays is mounted the first time it is shown and kept: switching back keeps its filters and its scroll, as Season keeps its own.
  const [playsShown, setPlaysShown] = useState(view === "plays");
  if (view === "plays" && !playsShown) setPlaysShown(true);
  const teamKey = `${competitionId}:${teamId}`;
  const { user, activeOrgId, activeOrgIsPersonal } = useAuth();
  // An open team in the sidebar once its name is known, and how it was left, so its row opens it that way.
  const tabScope = gameTabsScope(user?.id, activeOrgId);
  useEffect(() => {
    if (competitionId && name) rememberTeamTab(tabScope, teamTabId(competitionId, teamId), name);
  }, [tabScope, competitionId, teamId, name]);
  useEffect(() => {
    if (competitionId) rememberTeamLeft(teamTabId(competitionId, teamId), location.search, location.state);
  }, [competitionId, teamId, location.search, location.state]);
  // Collecting from the team's games, into a target remembered per team.
  const collectScope = useMemo<CollectScope>(
    () => ({
      key: `team:${teamKey}`,
      games: teamGames.flatMap((g) => plays.matches.get(g.gameId) ?? []),
      title: `Scout ${name || "Team"}`,
      surface: "team_plays",
    }),
    [teamKey, teamGames, plays.matches, name],
  );
  const collect = useCollect({ scope: collectScope, orgId: activeOrgId, includeUnscoped: activeOrgIsPersonal });
  const labelGames = useMemo(() => teamGames.map((g) => g.gameId), [teamGames]);
  const clipLabels = useClipLabels(playsShown ? activeOrgId : null, labelGames, "team_plays");
  // The empty Plays view's one action: their latest played game that can be imported and isn't in the library.
  const latestImport = useMemo<LatestImport | null>(() => {
    const r = [...rows].reverse().find((x) => x.status === "played" && x.importable && !library.games.has(x.matchId));
    if (!r) return null;
    const p = importPick(r);
    return { label: `${r.home ? "vs" : "at"} ${r.opponentName}, ${playedDay(r.at)}`, state: p ? { pick: p } : null };
  }, [rows, library.games, importPick]);

  // Once per open of Plays, when its games are read.
  const playsViewed = useRef(false);
  useEffect(() => {
    if (view !== "plays" || plays.status === "reading" || playsViewed.current) return;
    playsViewed.current = true;
    trackEvent("team_plays_viewed", {
      games: plays.games.length,
      plays: video ? video.all[side] : 0,
      from: state.playsFrom ?? "switch",
      side,
    });
  }, [view, plays.status, plays.games.length, video, side, state.playsFrom]);

  const where = useMemo(() => (league && profile ? teamGroupLabel(league, profile.group, fixtures) : null), [league, profile, fixtures]);

  // New report / Open report: one report per game to come against the space's team.
  const reportTeam = useMemo(() => (competitionId && profile ? { competitionId, teamId } : null), [competitionId, teamId, profile]);
  const reportGame = useMemo(() => nextMeeting(rows, mine), [rows, mine]);
  const report = useTeamReport(reportTeam, reportGame, "team_page");

  return (
    <Page>
      <Toolbar
        compactBelow="auto"
        back={TEAMS_FALLBACK}
        leading={profile && <TeamViewSwitch value={view} onChange={setView} />}
        title={name || (status === "ready" ? "Team" : "")}
        subtitle={seasonLabel}
        actions={
          profile ? (
            <>
              <TeamReportToolbarButton control={report} />
              {view === "plays" && plays.status !== "none" && <CollectControl collect={collect} />}
            </>
          ) : undefined
        }
      />
      {playsShown && profile && (
        <div className={cn("flex min-h-0 flex-1 flex-col pt-[var(--toolbar-height)]", view !== "plays" && "pointer-events-none invisible absolute inset-0")}>
          <TeamPlaysView
            key={teamKey}
            competitionId={competitionId}
            orgId={activeOrgId}
            plays={plays}
            side={side}
            onSide={(s) => setPlays({ side: s, pick: flipPick(pick, s) })}
            pick={pick}
            onClearPick={() => setPlays({ pick: null })}
            latestImport={latestImport}
            labels={clipLabels.labels}
            labelsOf={clipLabels.labelsOf}
            labelHandlers={clipLabels.handlers}
            collect={collect}
            active={view === "plays"}
          />
        </div>
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", view === "plays" && profile && "pointer-events-none invisible absolute inset-0")}>
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
              name={name}
              profile={profile}
              rows={rows}
              library={library.games}
              mine={mine}
              watchAll={video ? { plays: video.all.with, onWatch: () => watch(null, "with", "watch_all") } : null}
              failedReads={plays.status === "ready" && plays.failed.length > 0 ? { failed: plays.failed.length, of: teamGames.length, retry: plays.retry } : null}
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
      </div>
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
