/**
 * Turning the served (or cached) league catalogue into something the picker
 * can render.
 *
 * Both callers hand us data we did not construct — an edge-function response
 * or a localStorage blob written by an older build — so `parseLeagueCatalog`
 * is deliberately strict and returns null rather than a partial list. The
 * client falls back to its bundled catalogue on null, which keeps a malformed
 * cache from emptying the league picker.
 */
import {
  PLAYOFF,
  REGULAR,
  type CatalogLeague,
  type CatalogSeason,
  type League,
} from '../types/league';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function parseSeason(raw: unknown): CatalogSeason | null {
  if (!isObject(raw)) return null;
  const { id, label, competitionId } = raw;
  if (!nonEmptyString(id) || !nonEmptyString(label)) return null;
  // A season with no usable competitionId can't be fetched, so it has no
  // business in the picker.
  if (typeof competitionId !== 'number' || !Number.isFinite(competitionId) || competitionId <= 0) {
    return null;
  }
  return { id, label, competitionId };
}

function parseLeague(raw: unknown): CatalogLeague | null {
  if (!isObject(raw)) return null;
  const { id, name, country, gender, seasons } = raw;
  if (!nonEmptyString(id) || !nonEmptyString(name) || !nonEmptyString(country)) return null;
  if (gender !== 'men' && gender !== 'women') return null;
  if (!Array.isArray(seasons) || seasons.length === 0) return null;

  const parsed: CatalogSeason[] = [];
  for (const s of seasons) {
    const season = parseSeason(s);
    if (!season) return null; // all-or-nothing: a half-read league is worse than none
    parsed.push(season);
  }
  return { id, name, country, gender, seasons: parsed };
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
 * Wire shape -> picker shape. Stages are attached here rather than served:
 * nothing server-side reads them, and the only consumer is the client-side
 * matchType filter in getLeagueSchedule.
 */
export function catalogToLeagues(catalog: CatalogLeague[]): League[] {
  return catalog.map((l) => ({
    id: l.id,
    name: l.name,
    country: l.country,
    gender: l.gender,
    seasons: l.seasons.map((s) => ({
      id: s.id,
      label: s.label,
      competitionId: s.competitionId,
      stages: [REGULAR, PLAYOFF],
    })),
  }));
}
