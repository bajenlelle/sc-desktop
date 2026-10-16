/**
 * Turning the served (or cached) league catalogue into something the picker
 * can render.
 *
 * Both callers hand us data we did not construct — an edge-function response
 * or a localStorage blob written by an older build — so `parseLeagueCatalog`
 * is deliberately strict and returns null rather than a partial list. The
 * client falls back to its bundled catalogue on null, which keeps a malformed
 * cache from emptying the league picker.
 *
 * Two season shapes are accepted: Genius (a positive `competitionId`) and
 * Profixio (`provider: "profixio"` with a league handle). The Genius rules are
 * unchanged from before Profixio existed, so a catalogue written by an older
 * function or build still parses identically.
 */
import {
  PLAYOFF,
  REGULAR,
  type CatalogLeague,
  type CatalogSeason,
  type League,
  type ProfixioSeasonHandle,
  type Season,
} from '../types/league';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function positiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function parseProfixioHandle(raw: unknown): ProfixioSeasonHandle | null {
  if (!isObject(raw)) return null;
  const { leagueId, seasonId, tournamentId } = raw;
  if (!positiveInt(leagueId)) return null;
  if (seasonId !== undefined && !positiveInt(seasonId)) return null;
  if (tournamentId !== undefined && !positiveInt(tournamentId)) return null;
  const handle: ProfixioSeasonHandle = { leagueId };
  if (seasonId !== undefined) handle.seasonId = seasonId;
  if (tournamentId !== undefined) handle.tournamentId = tournamentId;
  return handle;
}

function parseSeason(raw: unknown): CatalogSeason | null {
  if (!isObject(raw)) return null;
  const { id, label, competitionId, provider, profixio } = raw;
  if (!nonEmptyString(id) || !nonEmptyString(label)) return null;

  if (provider === 'profixio') {
    const handle = parseProfixioHandle(profixio);
    return handle ? { id, label, provider: 'profixio', profixio: handle } : null;
  }
  if (provider !== undefined && provider !== 'genius') return null;

  // A Genius season with no usable competitionId can't be fetched, so it has
  // no business in the picker.
  if (!positiveInt(competitionId)) return null;
  return provider === undefined
    ? { id, label, competitionId }
    : { id, label, competitionId, provider };
}

function parseLeague(raw: unknown): CatalogLeague | null {
  if (!isObject(raw)) return null;
  const { id, name, country, gender, region, provider, seasons } = raw;
  if (!nonEmptyString(id) || !nonEmptyString(name) || !nonEmptyString(country)) return null;
  if (provider !== undefined && provider !== 'genius' && provider !== 'profixio') return null;
  // Genius leagues always carry a gender; Profixio youth leagues may not.
  if (gender !== 'men' && gender !== 'women' && !(gender === undefined && provider === 'profixio')) {
    return null;
  }
  if (region !== undefined && !nonEmptyString(region)) return null;
  if (!Array.isArray(seasons) || seasons.length === 0) return null;

  const parsed: CatalogSeason[] = [];
  for (const s of seasons) {
    const season = parseSeason(s);
    if (!season) return null; // all-or-nothing: a half-read league is worse than none
    parsed.push(season);
  }
  const league: CatalogLeague = { id, name, country, seasons: parsed };
  if (gender !== undefined) league.gender = gender;
  if (region !== undefined) league.region = region;
  if (provider !== undefined) league.provider = provider;
  return league;
}

/**
 * Validate a catalogue payload. Returns null for anything malformed — including
 * an empty list, which would mean "no leagues at all" and is never a legitimate
 * answer.
 */
export function parseLeagueCatalog(raw: unknown): CatalogLeague[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const leagues: CatalogLeague[] = [];
  for (const l of raw) {
    const league = parseLeague(l);
    if (!league) return null;
    leagues.push(league);
  }
  return leagues;
}

/**
 * Wire shape -> picker shape. Genius stages are attached here rather than
 * served: nothing server-side reads them, and the only consumer is the
 * client-side matchType filter in getLeagueSchedule. Profixio stages are the
 * league's categories, fetched once the season is selected, so they start empty.
 */
export function catalogToLeagues(catalog: CatalogLeague[]): League[] {
  return catalog.map((l) => {
    const league: League = {
      id: l.id,
      name: l.name,
      country: l.country,
      gender: l.gender,
      seasons: l.seasons.map((s): Season =>
        s.provider === 'profixio'
          ? { id: s.id, label: s.label, provider: 'profixio', profixio: s.profixio, stages: [] }
          : {
              id: s.id,
              label: s.label,
              provider: 'genius',
              competitionId: s.competitionId,
              stages: [REGULAR, PLAYOFF],
            },
      ),
    };
    if (l.region !== undefined) league.region = l.region;
    if (l.provider !== undefined) league.provider = l.provider;
    return league;
  });
}
