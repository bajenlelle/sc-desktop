import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Shield } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { resolveLeagueTeam } from "@/lib/team-report";
import { useLeagues } from "@/lib/use-leagues";

/**
 * A stable team (league_teams) to its newest season's page: a team gets a new
 * Genius id each season, so search and, later, a report's opponent name the
 * team and this finds the page. Replaces itself, so Back skips it.
 */
export function TeamFindPage() {
  const { leagueTeamId = "" } = useParams();
  const navigate = useNavigate();
  const state = useLocation().state;
  const leagues = useLeagues();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    resolveLeagueTeam(leagueTeamId, leagues)
      .then((team) => {
        if (cancelled) return;
        if (!team) return setMissing(true);
        navigate(`/teams/${team.competitionId}/${team.teamId}`, { replace: true, state });
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [leagueTeamId, leagues, navigate, state]);

  return (
    <Page>
      <Toolbar title="Team" />
      <PageContent width="wide">
        {missing && (
          <EmptyState
            icon={<Shield />}
            title="This team isn't in a league we follow."
            body="Teams lists the leagues you can import games from."
            action={
              <Button size="sm" variant="outline" asChild>
                <Link to="/teams">Go to Teams</Link>
              </Button>
            }
          />
        )}
      </PageContent>
    </Page>
  );
}
