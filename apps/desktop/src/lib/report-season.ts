import { useMemo } from "react";
import type { GeniusFixture } from "@scoutable/shared/lib/genius";
import { leagueSeason } from "@scoutable/shared/lib/league-season";
import type { ReportTeam } from "@scoutable/shared/lib/report-draft";
import type { ReportGameRow, ReportSeasonSnapshot } from "@scoutable/shared/lib/scouting-report";
import type { SeasonPayload } from "@scoutable/shared/lib/season-payload";
import { ordinal } from "@scoutable/shared/lib/season-copy";
import { paceLine } from "@scoutable/shared/lib/team-copy";
import { MIN_KEY_GAMES } from "@scoutable/shared/lib/team-keys";
import { teamGameRows, teamGroupLabel } from "@scoutable/shared/lib/team-schedule";
import { gameDay, playedDay } from "@/components/team/dates";
import { POINTS_FROM, PROFILE_ROWS } from "@/components/team/team-profile-section";
import { useLeague } from "@/lib/use-league";

/**
 * A report's How they play and Their games, written as the Team page writes
 * them (team-profile-section.tsx, team-games-section.tsx), from the league's
 * season and fixtures. The editor draws it as it is now; publishing stores it.
 */
export function seasonSnapshot(team: ReportTeam, payload: SeasonPayload, fixtures: readonly GeniusFixture[], now = new Date()): ReportSeasonSnapshot {
  const league = leagueSeason(payload);
  const profile = league.teams.get(team.teamId) ?? null;
  const rows = teamGameRows(fixtures as GeniusFixture[], payload, team.teamId, now);

  let profileBlock: ReportSeasonSnapshot["profile"] = null;
  if (profile && profile.games > 0) {
    const placed = profile.games >= MIN_KEY_GAMES;
    const where = teamGroupLabel(league, profile.group, fixtures);
    const placeOf = (p: number | null) => (placed && p !== null ? ordinal(p) : null);
    const perGame = POINTS_FROM.filter((f) => profile.perGame[f.key] !== null).map((f) => `${f.label} ${Math.round(profile.perGame[f.key]!)}`);
    profileBlock = {
      context: `Against ${where ?? "the league"} · ${profile.games} ${profile.games === 1 ? "game" : "games"}`,
      rows: PROFILE_ROWS.map((r) => ({
        label: r.label,
        own: profile.own[r.key] === null ? "–" : r.format(profile.own[r.key]!),
        ownPlace: placeOf(profile.place.own[r.key]),
        allowed: profile.allowed[r.key] === null ? "–" : r.format(profile.allowed[r.key]!),
        allowedPlace: placeOf(profile.place.allowed[r.key]),
      })),
      lines: [
        ...(profile.own.pace !== null ? [paceLine(profile.own.pace, placed ? profile.place.own.pace : null, profile.of)] : []),
        ...(perGame.length > 0 ? [`Points a game from ${perGame.join(" · ")}`] : []),
      ],
    };
  }

  // Results newest first, then the games still to play, soonest first.
  const played = rows.filter((r) => r.status === "played").reverse();
  const upcoming = rows.filter((r) => r.status === "upcoming");
  const games: ReportGameRow[] = [...played, ...upcoming].map((r) => ({
    date: r.at ? (r.status === "upcoming" ? gameDay(r.at) : playedDay(r.at)) : "",
    opponent: r.opponentName,
    home: r.home,
    result: r.status === "played" && r.score && r.result ? `${r.result} ${r.score.own}–${r.score.opp}` : null,
  }));
  return { profile: profileBlock, games: games.length > 0 ? games : null };
}

/** The report's team's season as a snapshot, once the league's numbers are read (cached by league-data.ts); null without a team. */
export function useReportSeason(team: ReportTeam | null | undefined): ReportSeasonSnapshot | null {
  const { payload, fixtures } = useLeague(team?.competitionId ?? null);
  return useMemo(() => (team && payload ? seasonSnapshot(team, payload, fixtures) : null), [team, payload, fixtures]);
}
