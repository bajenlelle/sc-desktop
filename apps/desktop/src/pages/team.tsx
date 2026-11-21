import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Shield } from "lucide-react";
import { teamKeys } from "@scoutable/shared/lib/team-keys";
import { groupNames, teamGameRows, teamNames } from "@scoutable/shared/lib/team-schedule";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { TeamHeader } from "@/components/team/team-header";
import { TeamKeysSection } from "@/components/team/team-keys-section";
import { TeamProfileSection } from "@/components/team/team-profile-section";
import { Button } from "@/components/ui/button";
import { useLeague } from "@/lib/use-league";
import { useLeagues } from "@/lib/use-leagues";
import { useLibraryGames } from "@/lib/use-library-games";
import { useMyTeamIds } from "@/lib/use-my-team-ids";

/** Where the page was opened from, as the links that open it say (team_page_viewed's `from`). */
export type TeamPageFrom = "teams" | "game" | "search" | "team" | "other";

/** What a link to a team's page carries: where it came from, and where Back goes when that isn't Teams. */
export interface TeamPageState {
  from?: TeamPageFrom;
  back?: { label: string; path: string };
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
  const seasonLabel = useMemo(() => {
    for (const l of leagues) {
      const s = l.seasons.find((x) => x.competitionId === competitionId);
      if (s) return `${l.name} · ${s.label}`;
    }
    return undefined;
  }, [leagues, competitionId]);

  const { status, payload, fixtures, league, retry } = useLeague(competitionId);
  const library = useLibraryGames();
  const mine = useMyTeamIds(competitionId, leagues);

  const profile = league?.teams.get(teamId) ?? null;
  const name = useMemo(() => teamNames(fixtures).get(teamId)?.name ?? "", [fixtures, teamId]);
  const rows = useMemo(() => (payload ? teamGameRows(fixtures, payload, teamId, new Date()) : []), [fixtures, payload, teamId]);
  const keys = useMemo(() => (profile && league ? teamKeys(profile, league) : null), [profile, league]);
  const group = league?.groups.find((g) => g.group === profile?.group) ?? null;
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
            <TeamHeader profile={profile} rows={rows} library={library.games} mine={mine} />
            {keys && <TeamKeysSection keys={keys} where={where} />}
            <TeamProfileSection profile={profile} group={group} where={where} />
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
