/**
 * Which play-by-play provider a season or an imported match came from, and
 * the few defaults that differ between them.
 *
 * Provider is never a column: a match carries it in its namespaced
 * `sourceGameId` ("profixio:<matchId>") and its catalogue `leagueId`
 * ("profixio-<district>-<slug>"); Genius matches keep their bare ids, as
 * every row imported before Profixio existed does.
 */
import type { LeagueProvider, Season } from "../types/league";
import type { StoredMatch } from "../types/match";

export const PROFIXIO_SOURCE_PREFIX = "profixio:";
export const PROFIXIO_LEAGUE_PREFIX = "profixio-";

export function seasonProvider(season: Pick<Season, "provider">): LeagueProvider {
  return season.provider ?? "genius";
}

export function matchProvider(
  match: Pick<StoredMatch, "sourceGameId" | "leagueId">,
): LeagueProvider {
  if (match.sourceGameId?.startsWith(PROFIXIO_SOURCE_PREFIX)) return "profixio";
  if (match.leagueId?.startsWith(PROFIXIO_LEAGUE_PREFIX)) return "profixio";
  return "genius";
}

export const DEFAULT_PRE_ROLL = 10;
export const DEFAULT_POST_ROLL = 3;

/**
 * Seconds of video before and after an event's time, per provider. Equal
 * since 2026-10-16 (Leonard's call). Profixio events are typed in by the
 * table after the play, and the sync anchor (the first made basket) carries
 * the same lag, so the common part cancels; what varies with how busy the
 * table is does not. On the one measured game, events landed between 12 s
 * before and 4 s after the computed time, so a clip logged late can start
 * after the ball has left the shooter's hands; the coach can lengthen the
 * clip or the playlist then.
 */
const PRE_ROLL: Record<LeagueProvider, number> = { genius: DEFAULT_PRE_ROLL, profixio: DEFAULT_PRE_ROLL };
const POST_ROLL: Record<LeagueProvider, number> = { genius: DEFAULT_POST_ROLL, profixio: DEFAULT_POST_ROLL };

export function defaultPreRoll(
  match?: Pick<StoredMatch, "sourceGameId" | "leagueId"> | null,
): number {
  return match ? PRE_ROLL[matchProvider(match)] : DEFAULT_PRE_ROLL;
}

/** Pre-roll for a playlist spanning several games: the longest default wins. */
export function defaultPreRollForMatches(
  matches: Array<Pick<StoredMatch, "sourceGameId" | "leagueId">>,
): number {
  return matches.reduce((max, m) => Math.max(max, defaultPreRoll(m)), DEFAULT_PRE_ROLL);
}

export function defaultPostRoll(
  match?: Pick<StoredMatch, "sourceGameId" | "leagueId"> | null,
): number {
  return match ? POST_ROLL[matchProvider(match)] : DEFAULT_POST_ROLL;
}

/** Post-roll for a playlist spanning several games: the longest default wins. */
export function defaultPostRollForMatches(
  matches: Array<Pick<StoredMatch, "sourceGameId" | "leagueId">>,
): number {
  return matches.reduce((max, m) => Math.max(max, defaultPostRoll(m)), DEFAULT_POST_ROLL);
}
