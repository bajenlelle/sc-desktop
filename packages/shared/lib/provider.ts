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

export const DEFAULT_POST_ROLL = 3;

/**
 * Seconds of video before an event's wall-clock time. Genius actions are
 * stamped by a clock operator at the play; Profixio events are typed in by
 * the scorer's table 10–20 s after it, so the clip has to start earlier to
 * contain the play at all.
 */
export function defaultPreRoll(
  match?: Pick<StoredMatch, "sourceGameId" | "leagueId"> | null,
): number {
  return match && matchProvider(match) === "profixio" ? 20 : 10;
}

/**
 * Pre-roll for a playlist spanning several games: the longest default wins.
 * A long pre-roll only lengthens a Genius clip; a short one cuts the play
 * out of a Profixio clip.
 */
export function defaultPreRollForMatches(
  matches: Array<Pick<StoredMatch, "sourceGameId" | "leagueId">>,
): number {
  return matches.reduce((max, m) => Math.max(max, defaultPreRoll(m)), 10);
}
