import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import { leagueTables, nextGame } from "@scoutable/shared/lib/team-schedule";
import { choiceKey, leagueChoices, pickTeamsLeague, type LeagueChoice } from "@scoutable/shared/lib/teams-league";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { gameDay } from "@/components/team/dates";
import { LeagueTable, LeagueTableSkeleton } from "@/components/team/league-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";
import { useLeague } from "@/lib/use-league";
import { useLeagues } from "@/lib/use-leagues";
import { useLibraryGames } from "@/lib/use-library-games";
import { useMyTeamIds, useSpaceTeam } from "@/lib/use-my-team-ids";

const rememberKey = (orgId: string) => `scoutable_teams_league:${orgId}`;

function readRemembered(orgId: string | null): string | null {
  if (!orgId) return null;
  try {
    return localStorage.getItem(rememberKey(orgId));
  } catch {
    return null;
  }
}

function remember(orgId: string | null, choice: LeagueChoice): void {
  if (!orgId) return;
  try {
    localStorage.setItem(rememberKey(orgId), choiceKey(choice));
  } catch {
    // A convenience only: the page still opens on a sensible league without it.
  }
}

/**
 * The league's teams (docs/teams.md): one table per group, in standings order,
 * with each team's points per possession at both ends and how many of its
 * games the coach has. A row opens the team's page.
 */
export function TeamsPage() {
  const { activeOrgId } = useAuth();
  const leagues = useLeagues();
  const choices = useMemo(() => leagueChoices(leagues), [leagues]);
  const library = useLibraryGames();
  const spaceTeam = useSpaceTeam();
  const [chosen, setChosen] = useState<string | null>(() => readRemembered(activeOrgId));
  useEffect(() => setChosen(readRemembered(activeOrgId)), [activeOrgId]);

  const choice = useMemo(
    () =>
      pickTeamsLeague(choices, {
        remembered: chosen,
        myTeam: spaceTeam ? { leagueId: spaceTeam.leagueId, seasonId: spaceTeam.seasonId } : null,
        newestGameLeagueId: library.newestLeagueId,
      }),
    [choices, chosen, spaceTeam, library.newestLeagueId],
  );
  const competitionId = choice?.competitionId ?? null;
  const { status, payload, fixtures, league, retry } = useLeague(competitionId);
  const mine = useMyTeamIds(competitionId, leagues);
  const libraryIds = useMemo(() => new Set(library.games.keys()), [library.games]);

  const tables = useMemo(() => (league ? leagueTables(league, fixtures, libraryIds, mine) : []), [league, fixtures, libraryIds, mine]);
  const next = useMemo(() => (payload ? nextGame(fixtures, payload, mine, new Date()) : null), [payload, fixtures, mine]);

  const pick = (key: string) => {
    const c = choices.find((x) => choiceKey(x) === key);
    if (!c) return;
    remember(activeOrgId, c);
    setChosen(key);
  };

  return (
    <Page>
      <Toolbar
        title="Teams"
        principal={
          choice ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {choice.label}
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuRadioGroup value={choiceKey(choice)} onValueChange={pick}>
                  {choices.map((c) => (
                    <DropdownMenuRadioItem key={choiceKey(c)} value={choiceKey(c)}>
                      {c.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />
      <PageContent width="wide">
        {!choice ? (
          <EmptyState icon={<Shield />} title="No leagues yet" body="Teams appear here for the leagues you can import games from." />
        ) : status === "failed" ? (
          <EmptyState
            title="Couldn't load the league."
            body="Check your connection and try again."
            action={
              <Button size="sm" variant="outline" onClick={retry}>
                Try again
              </Button>
            }
          />
        ) : status === "unavailable" ? (
          <EmptyState icon={<Shield />} title="This league has no team statistics." body="Choose another league above." />
        ) : status !== "ready" ? (
          <LeagueTableSkeleton />
        ) : (
          <div className="space-y-6">
            {next && (
              <Link
                to={`/teams/${competitionId}/${next.opponentId}`}
                state={{ from: "teams" }}
                className="group flex items-center gap-3 rounded-window bg-card px-4 py-3 ring-1 ring-separator outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-subheadline text-muted-foreground">Your next game</span>
                  <span className="block truncate font-medium text-foreground">
                    {next.opponentName}, {next.home ? "home" : "away"} · {gameDay(next.at)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
              </Link>
            )}
            {tables.map((t) => (
              <LeagueTable key={String(t.group)} table={t} competitionId={competitionId!} />
            ))}
          </div>
        )}
      </PageContent>
    </Page>
  );
}
