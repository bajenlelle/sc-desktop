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
/** Unlinked stat-keeper games (no official fixture): `sourceGameId = "voice:<sessionId>"`. */
export const VOICE_SOURCE_PREFIX = "voice:";
/** Pseudo-league id for the desktop's "My recorded games" list. */
export const VOICE_LEAGUE_ID = "voice";

export type ProviderMatch = Pick<StoredMatch, "sourceGameId" | "leagueId" | "statsSessionId">;

export function seasonProvider(season: Pick<Season, "provider">): LeagueProvider {
  return season.provider ?? "genius";
}

/**
 * A keeper's session wins over the game's own provider: when an official
 * Profixio or Genius game was imported with community stats, the events (and
 * their timing behaviour) are the keeper's, even though the game id is not.
 */
export function matchProvider(match: ProviderMatch): LeagueProvider {
  if (match.statsSessionId) return "voice";
  if (match.sourceGameId?.startsWith(VOICE_SOURCE_PREFIX)) return "voice";
  if (match.leagueId === VOICE_LEAGUE_ID) return "voice";
  if (match.sourceGameId?.startsWith(PROFIXIO_SOURCE_PREFIX)) return "profixio";
  if (match.leagueId?.startsWith(PROFIXIO_LEAGUE_PREFIX)) return "profixio";
  return "genius";
}

export const DEFAULT_PRE_ROLL = 10;
export const DEFAULT_POST_ROLL = 3;
/**
 * A stat keeper stamps the moment they start speaking, a reaction time after
 * the play rather than a table's entry lag, so the spread is expected to be
 * ±3 s. Starting values; calibrate on pilot games the way the Profixio
 * numbers below were measured.
 */
export const VOICE_PRE_ROLL = 12;
export const VOICE_POST_ROLL = 4;

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
export function defaultPreRoll(match?: ProviderMatch | null): number {
  if (!match) return DEFAULT_PRE_ROLL;
  switch (matchProvider(match)) {
    case "profixio": return 20;
    case "voice": return VOICE_PRE_ROLL;
    default: return DEFAULT_PRE_ROLL;
  }
}

export function defaultPreRollForMatches(matches: ProviderMatch[]): number {
  return matches.reduce((max, m) => Math.max(max, defaultPreRoll(m)), DEFAULT_PRE_ROLL);
}

/**
 * Seconds of video after an event's wall-clock time. Profixio events can also
 * fall up to ~4 s after the computed time (see above), so the clip gets a
 * longer tail there or it could end with the ball still in the air.
 */
export function defaultPostRoll(match?: ProviderMatch | null): number {
  if (!match) return DEFAULT_POST_ROLL;
  switch (matchProvider(match)) {
    case "profixio": return 6;
    case "voice": return VOICE_POST_ROLL;
    default: return DEFAULT_POST_ROLL;
  }
}

/** Post-roll for a playlist spanning several games: the longest default wins. */
export function defaultPostRollForMatches(matches: ProviderMatch[]): number {
  return matches.reduce((max, m) => Math.max(max, defaultPostRoll(m)), DEFAULT_POST_ROLL);
}
