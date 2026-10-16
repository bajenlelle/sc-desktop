/**
 * Profixio wire contract — the shapes the `profixio` edge function serves and
 * the pure helpers both it and the client share.
 *
 * Imported by the Deno function via a relative path, so this file has NO
 * runtime imports (the one `import type` is erased) and uses no DOM, Node or
 * Deno globals.
 *
 * Upstream is Profixio's documented API (`X-Api-Secret`), read with a key
 * that may view a fixed set of tournaments. Shapes verified against the live
 * API 2026-10-16.
 *
 * Identifiers:
 *   - leagueId     = the tournament's `league.id`, also its public page
 *                    (`/app/leagueid{N}`); a new id every season
 *   - tournamentId = the API's tournament id, what every API path takes
 *   - categoryId   = match category ("Nivå 1"); shared by site and API
 *   - matchId      = shared by site and API
 *   - teamId on events = the side's `teamRegistrationId`, also on lineup rows
 *                    as `webTeamId` (the name predates the API)
 */
// Structural twins of CatalogLeague / CatalogProfixioSeason (types/league.ts),
// declared here so this file stays import-free for the Deno bundler. The
// client validates the served catalogue with parseLeagueCatalog anyway.
export interface ProfixioCatalogSeason {
  id: string;
  label: string;
  provider: "profixio";
  profixio: { leagueId: number; seasonId?: number; tournamentId?: number };
}

export interface ProfixioCatalogLeague {
  id: string;
  name: string;
  country: string;
  gender?: "men" | "women";
  region?: string;
  provider: "profixio";
  seasons: ProfixioCatalogSeason[];
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** 2 = read through the API (1 was the scraped public pages; those rows are refetched). */
export const PROFIXIO_MATCH_SCHEMA_VERSION = 2 as const;

export interface ProfixioCategory {
  categoryId: number;
  name: string;
  matchCount: number | null;
}

export interface ProfixioScheduleRow {
  matchId: number;
  /** ISO UTC, whole seconds. */
  kickoff: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  hasResult: boolean;
  hasLivescore: boolean;
  /** Raw Profixio: H = hemma (home), B = borta (away). */
  winner: "H" | "B" | null;
  venue: string;
  matchUrl: string;
  homeLogo: string;
  awayLogo: string;
}

export interface ProfixioEventType {
  id: number;
  name: string;
  isGoalEvent: boolean;
  numberOfGoals: number | null;
  isPersonFoul: boolean;
  isTeamFoul: boolean;
  givesTimeout: boolean;
  gamestateStartStopType: number | null;
  switches2Players: boolean;
}

export interface ProfixioPerson {
  personId: number;
  name: string;
  number: string;
  isPlayer: boolean;
  isStaff: boolean;
}

export interface ProfixioClock {
  totalGameTime: string | null;
  timeInPeriod: string | null;
  display: string | null;
}

export interface ProfixioEvent {
  id: number;
  typeId: number;
  description: string;
  /** The side's teamRegistrationId, or null for match-level events (period markers). */
  teamId: number | null;
  isTeamEvent: boolean;
  period: number;
  scoreHome: number | null;
  scoreAway: number | null;
  /** ISO UTC, whole seconds — the video-sync timestamp. */
  startedAt: string;
  sortOrder: number;
  goals: number | null;
  startsMatch: boolean;
  startsPeriod: boolean;
  stopsPeriod: boolean;
  stopsMatch: boolean;
  startsExtraPeriod: boolean;
  stopsExtraPeriod: boolean;
  isPersonFoul: boolean;
  isTeamFoul: boolean;
  timeout: boolean;
  /** Only when the match runs a clock (district leagues don't). */
  clock: ProfixioClock | null;
  person: ProfixioPerson | null;
}

export interface ProfixioLineupRow {
  webTeamId: number;
  teamRegistrationId: number | null;
  type: "player" | "staff";
  number: string;
  name: string;
  personId: number;
  starter: boolean;
  played: boolean;
  foulCount: number | null;
}

export interface ProfixioLeaguesResponse {
  leagues: ProfixioCatalogLeague[];
  /** false when an accessible tournament could not be read on the last refresh. */
  complete: boolean;
  fetchedAt: string;
}

export interface ProfixioCategoriesResponse {
  leagueId: number;
  name: string;
  districtId: number | null;
  tournamentId: number | null;
  seasonId: number | null;
  categories: ProfixioCategory[];
  fetchedAt: string;
}

export interface ProfixioScheduleResponse {
  leagueId: number;
  categoryId: number;
  /** Kickoff ascending; the client filters and re-sorts. */
  rows: ProfixioScheduleRow[];
  fetchedAt: string;
  /** Served from cache after an upstream failure. */
  stale: boolean;
  /** The lazy-loaded remainder of a large category could not be fetched. */
  partial: boolean;
}

export interface ProfixioMatchResponse {
  schemaVersion: typeof PROFIXIO_MATCH_SCHEMA_VERSION;
  leagueId: number;
  categoryId: number;
  matchId: number;
  schedule: ProfixioScheduleRow;
  homeWebId: number | null;
  awayWebId: number | null;
  matchPeriods: number;
  useMatchClock: boolean;
  /** Raw upstream state ("full_time", …) or a derived one. */
  state: string;
  final: boolean;
  eventTypes: ProfixioEventType[];
  /** Oldest first. */
  events: ProfixioEvent[];
  lineup: ProfixioLineupRow[];
  pbpStatus: "ok" | "empty";
  source: "api";
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Coercions
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Any Profixio timestamp → ISO-8601 UTC with whole seconds.
 * "2026-02-15T15:37:04.000000Z" → "2026-02-15T15:37:04Z". Six fractional
 * digits must never reach Date.parse: the desktop WebView is WebKit, which
 * rejects them. Bare "YYYY-MM-DD HH:MM:SS" is taken as UTC. Garbage → "".
 */
export function toIsoUtcSeconds(ts: string | null | undefined): string {
  if (!ts) return "";
  let s = String(ts).trim();
  if (!s) return "";
  s = s.replace(" ", "T");
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) s += "Z";
  s = s.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Upstream → wire mappers
// ---------------------------------------------------------------------------

/** One event from `GET /api/tournaments/{t}/matches/{m}/events` → wire event. */
export function mapApiEvent(input: object): ProfixioEvent {
  const raw = input as Raw;
  const score = isObject(raw.currentScore) ? raw.currentScore : null;
  const person = isObject(raw.person) ? raw.person : null;
  const timeInPeriod = strOrNull(raw.timeInPeriod);
  const display = strOrNull(raw.displayGameTime);
  const total = strOrNull(raw.totalGameTime);
  return {
    id: num(raw.id) ?? 0,
    typeId: num(raw.eventTypeId) ?? 0,
    description: str(raw.description),
    teamId: num(raw.teamId),
    isTeamEvent: bool(raw.isTeamEvent),
    period: num(raw.period) ?? 0,
    scoreHome: num(score?.home),
    scoreAway: num(score?.away),
    startedAt: toIsoUtcSeconds(strOrNull(raw.startedAt) ?? strOrNull(raw.created_at)),
    sortOrder: num(raw.sortOrder) ?? 0,
    goals: num(raw.goals),
    startsMatch: bool(raw.startsMatch),
    startsPeriod: bool(raw.startsPeriod),
    stopsPeriod: bool(raw.stopsPeriod),
    stopsMatch: bool(raw.stopsMatch),
    startsExtraPeriod: bool(raw.startsExtraPeriod),
    stopsExtraPeriod: bool(raw.stopsExtraPeriod),
    isPersonFoul: bool(raw.isPersonFoul),
    isTeamFoul: bool(raw.isTeamFoul),
    timeout: bool(raw.timeout),
    clock: timeInPeriod || display || total ? { totalGameTime: total, timeInPeriod, display } : null,
    person: person
      ? {
          personId: num(person.personId) ?? 0,
          name: str(person.name).trim(),
          number: str(person.number).trim(),
          isPlayer: person.isPlayer == null ? !bool(person.isStaff) : bool(person.isPlayer),
          isStaff: bool(person.isStaff),
        }
      : null,
  };
}

/**
 * `GET /api/tournaments/{t}/matches/{m}/lineup` → flat lineup rows. The body
 * is `{ data: { home: { players, staff }, away: {...}, referees, matchStaff } }`
 * and its rows carry no team id, so each side's teamRegistrationId comes from
 * the match. Reads only what the roster needs: birth dates, positions,
 * referees and table staff are personal data the importer has no use for and
 * never leave this function.
 */
export function mapApiLineup(
  input: unknown,
  sides: { homeTeamId: number | null; awayTeamId: number | null },
): ProfixioLineupRow[] {
  const body = isObject(input) ? input : {};
  const data = isObject(body.data) ? body.data : body;
  const rows: ProfixioLineupRow[] = [];
  for (const [key, teamId] of [["home", sides.homeTeamId], ["away", sides.awayTeamId]] as const) {
    const side = isObject(data[key]) ? (data[key] as Raw) : {};
    for (const [list, type] of [["players", "player"], ["staff", "staff"]] as const) {
      const entries = Array.isArray(side[list]) ? (side[list] as unknown[]) : [];
      for (const entry of entries) {
        if (!isObject(entry)) continue;
        rows.push({
          webTeamId: teamId ?? 0,
          teamRegistrationId: teamId,
          type,
          number: str(entry.number).trim(),
          name: `${str(entry.firstName).trim()} ${str(entry.lastName).trim()}`.trim(),
          personId: num(entry.personId) ?? 0,
          starter: bool(entry.starter),
          played: bool(entry.played),
          foulCount: num(entry.foulCount),
        });
      }
    }
  }
  return rows;
}

/** One row of `GET /api/organisations/{org}/matchEventTypes`. */
export function mapEventType(input: object): ProfixioEventType {
  const raw = input as Raw;
  return {
    id: num(raw.id) ?? 0,
    name: str(raw.name),
    isGoalEvent: bool(raw.isGoalEvent),
    numberOfGoals: num(raw.numberOfGoals),
    isPersonFoul: bool(raw.isPersonFoul),
    isTeamFoul: bool(raw.isTeamFoul),
    givesTimeout: bool(raw.givesTimeout),
    gamestateStartStopType: num(raw.gamestateStartStopType),
    switches2Players: bool(raw.switches2Players),
  };
}

/** One tournament the API key may view, reduced to what the catalogue needs. */
export interface ProfixioTournamentSummary {
  tournamentId: number;
  /** The tournament's `league.id` (= its public `leagueid{N}` page). */
  leagueId: number;
  name: string;
  /** null for national tournaments (Ungdoms-SM). */
  districtId: number | null;
  districtName: string;
  seasonId: number;
  seasonLabel: string;
}

function positiveId(v: unknown): number | null {
  const n = num(v);
  return n != null && Number.isInteger(n) && n > 0 ? n : null;
}

/** `GET /api/tournaments/{t}` `data` → summary; null for a cancelled, deactivated or league-less one. */
export function mapApiTournament(input: unknown, tournamentId: number): ProfixioTournamentSummary | null {
  if (!isObject(input) || input.isDeactivated === true || input.isCancelled === true) return null;
  const league = isObject(input.league) ? input.league : null;
  const season = league && isObject(league.season) ? league.season : null;
  const leagueId = positiveId(league?.id);
  const seasonId = positiveId(season?.id);
  if (!league || !leagueId || !seasonId) return null;
  const districtId = positiveId(league.districtId);
  const category = isObject(league.category) ? league.category : {};
  return {
    tournamentId,
    leagueId,
    // league.name is the clean one; the tournament name may carry the
    // division ("Seniorserier Herr - Herrar Division 2").
    name: str(league.name).trim() || str(input.name).trim(),
    districtId,
    districtName: str(category.description).trim() || (districtId ? `District ${districtId}` : "Ungdoms-SM"),
    seasonId,
    seasonLabel: str(season?.name).trim(),
  };
}

/**
 * `GET /api/tournaments/{t}/matchCategories` → categories, each with its
 * number of matches counted from `GET /api/tournaments/{t}/matches` (so the
 * Stage dropdown can leave empty ones out). `categoryCode` is the level
 * ("Nivå 1"); `name` only repeats the league's.
 */
export function mapApiCategories(categories: unknown[], matches: unknown[]): ProfixioCategory[] {
  const counts = new Map<number, number>();
  for (const m of matches) {
    const id = isObject(m) && isObject(m.matchCategory) ? positiveId(m.matchCategory.id) : null;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out: ProfixioCategory[] = [];
  for (const c of categories) {
    if (!isObject(c)) continue;
    const categoryId = positiveId(c.id);
    if (!categoryId) continue;
    out.push({ categoryId, name: str(c.categoryCode).trim() || str(c.name).trim(), matchCount: counts.get(categoryId) ?? 0 });
  }
  return out;
}

/** One match from `GET /api/tournaments/{t}/matches` → schedule row. */
export function mapApiScheduleRow(input: object, leagueId: number): ProfixioScheduleRow {
  const raw = input as Raw;
  const home = isObject(raw.homeTeam) ? raw.homeTeam : {};
  const away = isObject(raw.awayTeam) ? raw.awayTeam : {};
  const homeScore = num(home.goals);
  const awayScore = num(away.goals);
  const hasResult = bool(raw.hasWinner) || (homeScore != null && awayScore != null);
  const field = isObject(raw.field) ? raw.field : {};
  const arena = isObject(field.arena) ? field.arena : {};
  const matchId = num(raw.id) ?? 0;
  return {
    matchId,
    kickoff: toIsoUtcSeconds(strOrNull(raw.datetimeStart)),
    homeName: str(home.name).trim(),
    awayName: str(away.name).trim(),
    homeScore: hasResult ? homeScore : null,
    awayScore: hasResult ? awayScore : null,
    hasResult,
    hasLivescore: false,
    winner: bool(home.isWinner) ? "H" : bool(away.isWinner) ? "B" : null,
    venue: str(arena.arenaName ?? field.name).trim(),
    matchUrl: str(raw.matchUrl) || `https://www.profixio.com/app/leagueid${leagueId}/match/${matchId}`,
    homeLogo: "",
    awayLogo: "",
  };
}

// ---------------------------------------------------------------------------
// Driver-agnostic derivations
// ---------------------------------------------------------------------------

/** Oldest first by wall-clock, then id (upstream serves newest first). Pure. */
export function sortEvents(events: ProfixioEvent[]): ProfixioEvent[] {
  return [...events].sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.id - b.id,
  );
}

/**
 * The home side's team id, from the first goal that raised the home score
 * and carries a team — the fallback when a match arrives without its sides.
 */
export function deriveHomeWebId(events: ProfixioEvent[]): number | null {
  let prevHome = 0;
  for (const e of sortEvents(events)) {
    if (e.scoreHome == null) continue;
    if (e.goals != null && e.goals > 0 && e.scoreHome > prevHome && e.teamId != null) return e.teamId;
    prevHome = e.scoreHome;
  }
  return null;
}

/** The first team id that is not `homeWebId`. */
export function otherTeamId(events: ProfixioEvent[], homeWebId: number | null): number | null {
  for (const e of events) {
    if (e.teamId != null && e.teamId !== homeWebId) return e.teamId;
  }
  return null;
}

const FINAL_GRACE_MS = 3 * 3_600_000;

/**
 * Whether a match can be cached forever: full time (state or a stopsMatch
 * event) AND at least three hours past kickoff, so the table crew's
 * post-game corrections are still picked up.
 */
export function isFinal(
  state: string,
  events: ProfixioEvent[],
  kickoffIso: string,
  nowMs: number = Date.now(),
): boolean {
  const ended = state === "full_time" || events.some((e) => e.stopsMatch);
  if (!ended) return false;
  const kickoff = Date.parse(kickoffIso);
  return Number.isFinite(kickoff) ? nowMs - kickoff > FINAL_GRACE_MS : true;
}

/** Cache lifetime for a match row; Infinity = permanent. */
export function matchCacheTtlMs(
  row: { final: boolean; pbpStatus: "ok" | "empty"; kickoff: string },
  nowMs: number = Date.now(),
): number {
  if (row.final) return Infinity;
  if (row.pbpStatus === "empty") {
    const kickoff = Date.parse(row.kickoff);
    if (Number.isFinite(kickoff) && nowMs - kickoff > 7 * 24 * 3_600_000) return Infinity;
    return 6 * 3_600_000;
  }
  return 120_000;
}

// ---------------------------------------------------------------------------
// Catalogue composition (accessible tournaments → CatalogLeague[])
// ---------------------------------------------------------------------------

/** One (district, season) group of the tournaments the API key may view. */
export interface CatalogCrawlRow {
  /** The league's districtId; 0 for national tournaments (Ungdoms-SM). */
  districtId: number;
  districtName: string;
  seasonId: number;
  /** As Profixio shows it, e.g. "Säsongen 26/27". */
  seasonLabel: string;
  leagues: Array<{ leagueId: number; name: string; tournamentId?: number }>;
}

/** Tournaments → one catalogue row per (district, season); district 0 holds the national ones. */
export function groupTournaments(tournaments: ProfixioTournamentSummary[]): CatalogCrawlRow[] {
  const byKey = new Map<string, CatalogCrawlRow>();
  for (const t of tournaments) {
    const districtId = t.districtId ?? 0;
    const key = `${districtId}:${t.seasonId}`;
    let row = byKey.get(key);
    if (!row) {
      row = { districtId, districtName: t.districtName, seasonId: t.seasonId, seasonLabel: t.seasonLabel, leagues: [] };
      byKey.set(key, row);
    }
    row.leagues.push({ leagueId: t.leagueId, name: t.name, tournamentId: t.tournamentId });
  }
  return [...byKey.values()];
}

/** Swedish league names carry the gender: Herrar/Pojkar (men), Damer/Flickor (women). */
export function inferGender(name: string): "men" | "women" | undefined {
  const n = name.toLowerCase();
  if (/\b(herrar|herr|pojkar|pojk)\b/.test(n)) return "men";
  if (/\b(damer|dam|flickor|flick)\b/.test(n)) return "women";
  return undefined;
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Säsongen 26/27" → { id: "2026-27", label: "2026/27" }; anything else is slugified. */
export function seasonFromLabel(label: string): { id: string; label: string } {
  const m = label.match(/(\d{4}|\d{2})\s*\/\s*(\d{2})\b/);
  if (m) {
    const start = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    return { id: `${start}-${m[2]}`, label: `${start}/${m[2]}` };
  }
  return { id: slugify(label), label: label.trim() };
}

/**
 * One league per (district, name) with its seasons newest first — the
 * catalogue shape the desktop picker already renders. A Profixio league gets
 * a new "avdelning" id every season, which is why the handle lives on the
 * season.
 */
export function composeCatalog(rows: CatalogCrawlRow[]): ProfixioCatalogLeague[] {
  const byKey = new Map<string, ProfixioCatalogLeague>();
  for (const row of rows) {
    const season = seasonFromLabel(row.seasonLabel);
    for (const l of row.leagues) {
      const slug = slugify(l.name);
      if (!slug) continue;
      const key = `${row.districtId}:${slug}`;
      let league = byKey.get(key);
      if (!league) {
        league = {
          id: `profixio-${row.districtId}-${slug}`,
          name: l.name.trim(),
          country: "SE",
          region: row.districtName,
          provider: "profixio",
          seasons: [],
        };
        const gender = inferGender(l.name);
        if (gender) league.gender = gender;
        byKey.set(key, league);
      }
      if (league.seasons.some((s) => s.profixio.seasonId === row.seasonId)) continue;
      league.seasons.push({
        id: season.id,
        label: season.label,
        provider: "profixio",
        profixio: {
          leagueId: l.leagueId,
          seasonId: row.seasonId,
          ...(l.tournamentId ? { tournamentId: l.tournamentId } : {}),
        },
      });
    }
  }
  const leagues = [...byKey.values()];
  for (const l of leagues) {
    l.seasons.sort((a, b) => (b.profixio.seasonId ?? 0) - (a.profixio.seasonId ?? 0));
  }
  return leagues;
}
