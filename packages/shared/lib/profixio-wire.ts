/**
 * Profixio wire contract — the shapes the `profixio` edge function serves and
 * the pure, driver-agnostic helpers both it and the client share.
 *
 * Imported by the Deno function via a relative path, so this file has NO
 * runtime imports (the one `import type` is erased) and uses no DOM, Node or
 * Deno globals.
 *
 * Two upstream drivers feed these shapes — Profixio's public pages today and
 * its documented API (`X-Api-Secret`) once SBBF issues a token. The field
 * coercions below absorb the differences we know of (the API serves `teamId`
 * as a string, "" for none, and the clock as separate keys), and a vitest
 * parity test keeps `mapApiEvent` and `mapPublicEvent` identical.
 *
 * Identifiers (verified against live pages 2026-10-02):
 *   - leagueId    = public "avdelning" id (`/app/leagueid{N}`); a new id every season
 *   - tournamentId = the documented API's tournament id (`turnering_id` in page state)
 *   - categoryId  = match category ("Nivå 2A Herrar U19"); shared by site and API
 *   - matchId     = shared by site and API
 *   - teamId on events = the "web team id", also on lineup rows as `webTeamId`
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

export const PROFIXIO_MATCH_SCHEMA_VERSION = 1 as const;

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
  /** Web team id, or null for match-level events (period markers). */
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
  /** false when a district-season row is missing from the cache (cold crawl cut short). */
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
  source: "public" | "api";
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

/** One raw event from the public page's inline state → wire event. */
export function mapPublicEvent(input: object): ProfixioEvent {
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
 * One raw event from `GET /api/tournaments/{t}/matches/{m}/events`. Same
 * field names as the public payload; the coercions absorb the string teamId
 * ("" for none) and the separate clock keys.
 */
export const mapApiEvent: (input: object) => ProfixioEvent = mapPublicEvent;

/** One lineup row (public page or API; tolerant of both key spellings). */
export function mapPublicLineup(input: object): ProfixioLineupRow {
  const raw = input as Raw;
  const registration = num(raw.teamRegistrationId) ?? num(raw.teamid);
  return {
    webTeamId: num(raw.webTeamId) ?? registration ?? 0,
    teamRegistrationId: registration,
    type: raw.type === "staff" ? "staff" : "player",
    number: str(raw.number).trim(),
    name: str(raw.name).trim(),
    personId: num(raw.personId) ?? 0,
    starter: bool(raw.starter),
    played: bool(raw.played),
    foulCount: num(raw.foulCount),
  };
}

export const mapApiLineup: (input: object) => ProfixioLineupRow = mapPublicLineup;

/** One row of the event-type table (page inline state or `/matchEventTypes`). */
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
 * The home side's web team id, from the first goal that raised the home
 * score and carries a team. Works for both drivers and for payloads that
 * omit `homewebid`.
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
// Catalogue composition (district crawl → CatalogLeague[])
// ---------------------------------------------------------------------------

export interface CatalogCrawlRow {
  districtId: number;
  districtName: string;
  seasonId: number;
  /** As Profixio shows it, e.g. "Säsongen 26/27". */
  seasonLabel: string;
  leagues: Array<{ leagueId: number; name: string }>;
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
        profixio: { leagueId: l.leagueId, seasonId: row.seasonId },
      });
    }
  }
  const leagues = [...byKey.values()];
  for (const l of leagues) {
    l.seasons.sort((a, b) => (b.profixio.seasonId ?? 0) - (a.profixio.seasonId ?? 0));
  }
  return leagues;
}
