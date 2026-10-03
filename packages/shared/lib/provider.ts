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
 * Seconds of video before an event's wall-clock time.
 *
 * Genius actions are stamped by a clock operator at the play. Profixio events
 * are typed in by the table a few seconds after it; the sync anchor (the
 * first made basket) carries the same lag, so the common part cancels — but
 * the lag varies with how busy the table is. Measured on a real game (five
 * marked events plus the final buzzer): other events landed between 12 s
 * before and 4 s after the computed time. A 20 s pre-roll keeps ~8 s of play
 * ahead of the shot even in the slow-entry case; 10 s would start that clip
 * after the ball had left the shooter's hands.
 */
export function defaultPreRoll(
  match?: Pick<StoredMatch, "sourceGameId" | "leagueId"> | null,
): number {
  return match && matchProvider(match) === "profixio" ? 20 : DEFAULT_PRE_ROLL;
}

export function defaultPreRollForMatches(
  matches: Array<Pick<StoredMatch, "sourceGameId" | "leagueId">>,
): number {
  return matches.reduce((max, m) => Math.max(max, defaultPreRoll(m)), DEFAULT_PRE_ROLL);
}

/**
 * Seconds of video after an event's wall-clock time. Profixio events can also
 * fall up to ~4 s after the computed time (see above), so the clip gets a
 * longer tail there or it could end with the ball still in the air.
 */
export function defaultPostRoll(
  match?: Pick<StoredMatch, "sourceGameId" | "leagueId"> | null,
): number {
  return match && matchProvider(match) === "profixio" ? 6 : DEFAULT_POST_ROLL;
}

/** Post-roll for a playlist spanning several games: the longest default wins. */
export function defaultPostRollForMatches(
  matches: Array<Pick<StoredMatch, "sourceGameId" | "leagueId">>,
): number {
  return matches.reduce((max, m) => Math.max(max, defaultPostRoll(m)), DEFAULT_POST_ROLL);
}
