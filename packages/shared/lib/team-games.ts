/**
 * "Your games" in the import picker: a schedule read from the user's team's
 * side. Pure — the desktop picker feeds it the catalogue, the team's
 * per-season source ids (league_team_sources) and the loaded schedule.
 */
import type { League, Season, Stage } from '../types/league';
import type { ScheduleGame, ScheduleTeam } from './genius';

/** One season's source id for a team (a league_team_sources row). */
export interface TeamSource {
  source: string;
  sourceTeamId: string;
  leagueId: string;
  seasonId: string;
}

/** A season the team played, resolved against the catalogue. */
export interface TeamSeason {
  league: League;
  season: Season;
  /** The team's id(s) in that season's competition. */
  teamIds: ReadonlySet<string>;
}

/**
 * The seasons the team played in leagues we import from, newest first. Each
 * carries its own league, so a promoted or relegated team stays correct.
 * Seasons the catalogue doesn't carry, or without a Genius competition, drop out.
 */
export function teamSeasons(sources: TeamSource[], leagues: League[], source = 'genius'): TeamSeason[] {
  const byKey = new Map<string, TeamSeason & { teamIds: Set<string> }>();
  for (const s of sources) {
    if (s.source !== source) continue;
    const league = leagues.find((l) => l.id === s.leagueId);
    const season = league?.seasons.find((x) => x.id === s.seasonId);
    if (!league || !season?.competitionId) continue;
    const key = `${league.id}/${season.id}`;
    const entry = byKey.get(key) ?? { league, season, teamIds: new Set<string>() };
    entry.teamIds.add(s.sourceTeamId);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.season.id.localeCompare(a.season.id));
}

/** "2025/26 · Basketettan Herr". */
export function teamSeasonLabel(ts: TeamSeason): string {
  return `${ts.season.label} · ${ts.league.name}`;
}

export type GameResult = 'W' | 'L' | 'T';

/** A game seen from the team's side. */
export interface TeamGame {
  game: ScheduleGame;
  isHome: boolean;
  opponent: { name: string; icon: string };
  ours: number;
  theirs: number;
  result: GameResult;
  playoff: boolean;
}

function isOurs(side: ScheduleTeam, teamIds: ReadonlySet<string>): boolean {
  return side.teamId != null && teamIds.has(side.teamId);
}

/** The game from the team's side, or null when the team didn't play in it. */
export function fromTeamSide(game: ScheduleGame, teamIds: ReadonlySet<string>): TeamGame | null {
  const homeIsOurs = isOurs(game.homeTeamInfo, teamIds);
  if (!homeIsOurs && !isOurs(game.awayTeamInfo, teamIds)) return null;
  const us = homeIsOurs ? game.homeTeamInfo : game.awayTeamInfo;
  const them = homeIsOurs ? game.awayTeamInfo : game.homeTeamInfo;
  return {
    game,
    isHome: homeIsOurs,
    opponent: { name: them.names.short, icon: them.icon },
    ours: us.score,
    theirs: them.score,
    result: us.score > them.score ? 'W' : us.score < them.score ? 'L' : 'T',
    playoff: game.matchType === 'FINALS',
  };
}

/** The team's games, newest first. */
export function teamGames(games: ScheduleGame[], teamIds: ReadonlySet<string>): TeamGame[] {
  return games
    .map((g) => fromTeamSide(g, teamIds))
    .filter((g): g is TeamGame => g !== null)
    .sort((a, b) => Date.parse(b.game.rawStartDateTime) - Date.parse(a.game.rawStartDateTime));
}

/** The newest game not yet imported into this space; null when everything is. */
export function latestToImport(games: TeamGame[], importedIds: ReadonlySet<string>): TeamGame | null {
  return games.find((g) => !importedIds.has(g.game.uuid)) ?? null;
}

/** The season's stage for a game's match type (regular season when unknown). */
export function stageForMatchType(season: Season, matchType: string | undefined): Stage | null {
  return season.stages.find((s) => s.matchType === matchType) ?? season.stages[0] ?? null;
}
