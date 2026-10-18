/**
 * League catalogue + game data for the importer, behind two providers and
 * two edge functions (this module never talks to a league site directly):
 *   - Genius Sports (SBF's national leagues) through `genius`, which holds
 *     the API key and caches every response. A Genius "competition" IS a
 *     league-season, so each Season carries one competitionId.
 *   - Profixio (SBBF district basketball) through `profixio`, which reads
 *     the documented API. A Profixio season carries a league handle; its
 *     stages are the league's categories, fetched once the season is
 *     selected.
 * Everything downstream of ScheduleGame / GameData is provider-blind.
 *
 * Shared by the desktop and the web importer: each function takes the app's
 * SupabaseClient, as the db modules do. The desktop's lib/basketball-api.ts
 * is a thin wrapper that binds its client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGeniusFixtures, getGeniusMatch } from "./genius-client";
import {
  buildRosters,
  findGeniusPeriodMarks,
  findTipoff,
  fixtureToScheduleGame,
  playableFixtures,
  homeCompetitor,
  normalizeGeniusActions,
  type ScheduleGame,
} from "./genius";
import { getProfixioCategories, getProfixioMatch, getProfixioSchedule } from "./profixio-client";
import {
  buildProfixioRosters,
  categoriesToStages,
  findProfixioPeriodMarks,
  findProfixioSyncAnchor,
  normalizeProfixioEvents,
  parseProfixioSourceGameId,
  profixioRowToScheduleGame,
  resolveSides,
} from "./profixio";
import { seasonProvider } from "./provider";
import type { PlayByPlayEvent, SyncPoint } from "../types/match";
import { PLAYOFF, REGULAR, type League, type Season, type Stage } from "../types/league";

export type { ScheduleGame };
export type { League, Season, Stage };

const season = (id: string, label: string, competitionId: number): Season => ({
  id,
  label,
  competitionId,
  stages: [REGULAR, PLAYOFF],
});

/**
 * Fallback catalogue, NOT the source of truth: that lives in the `genius`
 * edge function and arrives via each app's useLeagues(). This copy is what
 * the picker shows before the first successful fetch, and whenever one
 * fails: an empty league list would be a worse outcome than a slightly stale
 * one.
 *
 * It only needs refreshing when it drifts far enough to be misleading; a new
 * season reaches users through a function deploy, with no app release.
 */
export const BUNDLED_LEAGUES: League[] = [
  {
    id: "sbl-herr",
    name: "SBL Herr",
    country: "SE",
    gender: "men",
    seasons: [season("2026-27", "2026/27", 48974), season("2025-26", "2025/26", 41539)],
  },
  {
    id: "sbl-dam",
    name: "SBL Dam",
    country: "SE",
    gender: "women",
    seasons: [season("2026-27", "2026/27", 49288), season("2025-26", "2025/26", 42013)],
  },
  {
    id: "superettan-herr",
    name: "Superettan Herr",
    country: "SE",
    gender: "men",
    seasons: [season("2026-27", "2026/27", 49176), season("2025-26", "2025/26", 42132)],
  },
  {
    id: "basketettan-herr",
    name: "Basketettan Herr",
    country: "SE",
    gender: "men",
    seasons: [season("2026-27", "2026/27", 50039), season("2025-26", "2025/26", 42251)],
  },
  {
    id: "basketettan-dam",
    name: "Basketettan Dam",
    country: "SE",
    gender: "women",
    seasons: [season("2026-27", "2026/27", 50038), season("2025-26", "2025/26", 42250)],
  },
];

// Placeholder leagues for national team coaches; the season handles are
// filled in once the data source (provider TBD) is decided.
const NT_PLACEHOLDER_SEASONS: Season[] = [
  { id: "current", label: "Current", stages: [{ id: "regular", label: "All games" }] },
];

// NOTE: keep these ids in sync with NT_LEAGUE_IDS in plan-tier.ts: that list
// is what exempts a match from the monthly club-import cap.
export const NATIONAL_TEAM_LEAGUES: League[] = [
  {
    id: "sweden-national-men",
    name: "Sweden Men",
    country: "SE",
    gender: "men",
    seasons: NT_PLACEHOLDER_SEASONS,
  },
  {
    id: "sweden-national-women",
    name: "Sweden Women",
    country: "SE",
    gender: "women",
    seasons: NT_PLACEHOLDER_SEASONS,
  },
];

/** Display names for the country codes used above. Drives picker grouping. */
export const COUNTRY_NAMES: Record<string, string> = {
  SE: "Sweden",
};

/** Regional-indicator flag emoji for an ISO-2 code, no image assets needed. */
export function countryFlag(code: string): string {
  if (code.length !== 2) return "";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// ---------------------------------------------------------------------------
// Grouping leagues for the picker
// ---------------------------------------------------------------------------

const NT_GROUP = "National teams";
const NT_LEAGUE_ID_SET = new Set(NATIONAL_TEAM_LEAGUES.map((l) => l.id));

/** The picker group a league belongs to: its district, else its country, national teams apart. */
export function leagueGroupName(league: League): string {
  if (NT_LEAGUE_ID_SET.has(league.id)) return NT_GROUP;
  // District leagues (Profixio) group by district ("Herrar U19" exists in
  // every one of them), national leagues by country.
  return league.region ?? COUNTRY_NAMES[league.country] ?? league.country;
}

/** Countries first, then districts alphabetically, national teams last. */
function groupRank(groupName: string, leagues: League[]): number {
  if (groupName === NT_GROUP) return 2;
  return leagues.every((l) => l.region) ? 1 : 0;
}

/**
 * The leagues matching `query` (by name, group or district), grouped for the
 * picker: countries, then districts, each alphabetically, national teams
 * always last. An empty query keeps every league.
 */
export function groupLeagues(leagues: League[], query = ""): [string, League[]][] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? leagues.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          leagueGroupName(l).toLowerCase().includes(q) ||
          (l.region?.toLowerCase().includes(q) ?? false),
      )
    : leagues;

  const byGroup = new Map<string, League[]>();
  for (const league of matches) {
    const key = leagueGroupName(league);
    const list = byGroup.get(key) ?? [];
    list.push(league);
    byGroup.set(key, list);
  }
  return Array.from(byGroup.entries()).sort(([a, la], [b, lb]) => {
    const rank = groupRank(a, la) - groupRank(b, lb);
    return rank !== 0 ? rank : a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// Stages and schedules
// ---------------------------------------------------------------------------

const byNewest = (a: ScheduleGame, b: ScheduleGame) =>
  new Date(b.rawStartDateTime).getTime() - new Date(a.rawStartDateTime).getTime();

/** One in-flight/settled categories fetch per Profixio league id; the catalogue refreshes churn object identity. */
const profixioStages = new Map<number, Promise<Stage[]>>();

/**
 * The stages the Stage dropdown offers for a season. Genius seasons carry
 * theirs (regular season / playoffs); a Profixio season's stages are the
 * league's categories ("Nivå 1", "Nivå 2A", …), fetched from the function.
 */
export function getSeasonStages(supabase: SupabaseClient, league: League, season: Season): Promise<Stage[]> {
  if (seasonProvider(season) !== "profixio") return Promise.resolve(season.stages);
  const leagueId = season.profixio?.leagueId;
  if (!leagueId) return Promise.resolve([]);
  let pending = profixioStages.get(leagueId);
  if (!pending) {
    pending = getProfixioCategories(supabase, leagueId).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch categories: ${res.error}`);
      return categoriesToStages(res.data.categories, league.name);
    });
    pending.catch(() => profixioStages.delete(leagueId));
    profixioStages.set(leagueId, pending);
  }
  return pending;
}

// A competition's playable games, kept for a few minutes per app session, so
// switching stage or between "Your games" and "All games" doesn't refetch.
// The genius function caches upstream for 6 h either way.
const SCHEDULE_TTL_MS = 5 * 60 * 1000;
const scheduleCache = new Map<number, { at: number; games: Promise<ScheduleGame[]> }>();

function playableSchedule(supabase: SupabaseClient, competitionId: number): Promise<ScheduleGame[]> {
  const hit = scheduleCache.get(competitionId);
  if (hit && Date.now() - hit.at < SCHEDULE_TTL_MS) return hit.games;
  const games = (async () => {
    const res = await getGeniusFixtures(supabase, competitionId);
    if (!res.ok) throw new Error(`Failed to fetch fixtures: ${res.error}`);
    return playableFixtures(res.data.fixtures)
      .map(fixtureToScheduleGame)
      .sort((a, b) => Date.parse(b.rawStartDateTime) - Date.parse(a.rawStartDateTime));
  })();
  scheduleCache.set(competitionId, { at: Date.now(), games });
  games.catch(() => scheduleCache.delete(competitionId)); // a failure is retried next time
  return games;
}

/**
 * Playable schedule for a league season, newest first: COMPLETE games that
 * carry play-by-play (anything else can't become clips). `stage: null` means
 * every stage; the "Your games" view merges regular season and playoffs.
 */
export async function getLeagueSchedule(
  supabase: SupabaseClient,
  _league: League,
  season: Season,
  stage: Stage | null,
): Promise<ScheduleGame[]> {
  if (seasonProvider(season) === "profixio") {
    if (!season.profixio || stage?.categoryId == null) return [];
    const res = await getProfixioSchedule(supabase, season.profixio.leagueId, stage.categoryId);
    if (!res.ok) throw new Error(`Failed to fetch schedule: ${res.error}`);
    // Only played games: the protocol fills in during the game, so an
    // unplayed row can't become clips yet.
    return res.data.rows.filter((r) => r.hasResult).map(profixioRowToScheduleGame).sort(byNewest);
  }

  if (!season.competitionId) return [];
  const games = await playableSchedule(supabase, season.competitionId);
  return stage?.matchType ? games.filter((g) => g.matchType === stage.matchType) : games;
}

// ---------------------------------------------------------------------------
// One game's data
// ---------------------------------------------------------------------------

export interface GameData {
  homeName: string;
  awayName: string;
  /** YYYY-MM-DD, from the fixture's UTC start time. */
  date: string;
  homeRoster: Array<{ jerseyNumber: string; playerName: string }>;
  awayRoster: Array<{ jerseyNumber: string; playerName: string }>;
  events: PlayByPlayEvent[];
  /** Wall-clock of the sync reference event: the tip-off for Genius, see `syncAnchor` otherwise. */
  tipoffRealWorldTime: string | null;
  /**
   * What `tipoffRealWorldTime` refers to when it isn't the tip-off. Profixio
   * games anchor on the first made basket (the table's "Start period 1" is
   * pressed minutes early); `label` is what the coach should look for.
   */
  syncAnchor?: { kind: "first_basket" | "match_start"; label: string };
  /**
   * Each period's reference times from the league (start, end, and what to
   * look for in the video), saved on the sync point so a video that skips
   * the breaks can be synced quarter by quarter, now or later.
   */
  periodMarks?: SyncPoint["marks"];
  /** "empty" = the match exists but carries no play-by-play upstream. */
  pbpStatus: "ok" | "empty";
}

/** @deprecated name kept for one release; use GameData. */
export type GeniusGameData = GameData;

/**
 * Everything the import flow needs for one game: names, date, rosters,
 * normalized events and the Q1 tipoff wall-clock for the sync hint.
 * One edge-function call; cached server-side, so re-imports are free.
 */
export async function fetchGameData(
  supabase: SupabaseClient,
  season: Season,
  game: ScheduleGame,
  stage?: Stage | null,
): Promise<GameData> {
  if (seasonProvider(season) === "profixio") {
    const matchId = parseProfixioSourceGameId(game.uuid);
    if (!season.profixio || matchId == null || stage?.categoryId == null) {
      throw new Error("League has no data source configured");
    }
    const res = await getProfixioMatch(supabase, season.profixio.leagueId, stage.categoryId, matchId);
    if (!res.ok) throw new Error(`Failed to fetch game data: ${res.error}`);
    const m = res.data;
    const homeName = game.homeTeamInfo.names.long;
    const awayName = game.awayTeamInfo.names.long;
    const ctx = { homeName, awayName };
    const rosters = buildProfixioRosters(m.lineup, resolveSides(m));
    const events = normalizeProfixioEvents(m, ctx);
    const anchor = findProfixioSyncAnchor(m, ctx);
    return {
      homeName,
      awayName,
      date: game.rawStartDateTime.slice(0, 10),
      homeRoster: rosters.home,
      awayRoster: rosters.away,
      events,
      tipoffRealWorldTime: anchor?.realWorldTime ?? null,
      syncAnchor: anchor ? { kind: anchor.kind, label: anchor.label } : undefined,
      periodMarks: findProfixioPeriodMarks(m, ctx),
      pbpStatus: events.length > 0 ? "ok" : "empty",
    };
  }

  if (!season.competitionId) throw new Error("League has no data source configured");
  const res = await getGeniusMatch(supabase, season.competitionId, Number(game.uuid));
  if (!res.ok) throw new Error(`Failed to fetch game data: ${res.error}`);

  const { fixture, actions, players, pbpStatus } = res.data;
  const home = homeCompetitor(fixture);
  const homeTeamId = home?.teamId ?? 0;
  const away = fixture.competitors.find((c) => c !== home);
  const rosters = buildRosters(players, homeTeamId);

  return {
    homeName: home?.teamName ?? game.homeTeamInfo.names.long,
    awayName: away?.teamName ?? game.awayTeamInfo.names.long,
    date: game.rawStartDateTime.slice(0, 10),
    homeRoster: rosters.home,
    awayRoster: rosters.away,
    events: normalizeGeniusActions(actions, homeTeamId),
    tipoffRealWorldTime: findTipoff(actions),
    periodMarks: findGeniusPeriodMarks(actions),
    pbpStatus,
  };
}
