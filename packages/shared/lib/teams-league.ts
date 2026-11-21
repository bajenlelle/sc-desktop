/**
 * Which leagues the Teams page offers and which it opens on (the design:
 * docs/superpowers/specs/2026-11-21-team-page-design.md, "The league").
 * Current seasons only: rosters are synced for those alone.
 */
import type { League } from "../types/league";

export interface LeagueChoice {
  leagueId: string;
  seasonId: string;
  competitionId: number;
  /** "Superettan Herr · 2026/27". */
  label: string;
}

/** Each league's current season that has a Genius competition, in the catalogue's order. */
export function leagueChoices(leagues: readonly League[]): LeagueChoice[] {
  const out: LeagueChoice[] = [];
  for (const league of leagues) {
    const season = league.seasons[0];
    if (!season?.competitionId || (season.provider && season.provider !== "genius")) continue;
    out.push({ leagueId: league.id, seasonId: season.id, competitionId: season.competitionId, label: `${league.name} · ${season.label}` });
  }
  return out;
}

export const choiceKey = (c: { leagueId: string; seasonId: string }) => `${c.leagueId}/${c.seasonId}`;

/**
 * The league the page opens on: the one chosen last in this space
 * (`remembered`, "<league>/<season>"), else the space's team's when its season
 * is current, else the league of the coach's newest Genius game, else the first.
 */
export function pickTeamsLeague(
  choices: readonly LeagueChoice[],
  hints: { remembered: string | null; myTeam: { leagueId: string; seasonId: string } | null; newestGameLeagueId: string | null },
): LeagueChoice | null {
  const remembered = choices.find((c) => choiceKey(c) === hints.remembered);
  if (remembered) return remembered;
  const team = hints.myTeam && choices.find((c) => choiceKey(c) === choiceKey(hints.myTeam!));
  if (team) return team;
  const newest = choices.find((c) => c.leagueId === hints.newestGameLeagueId);
  return newest ?? choices[0] ?? null;
}
