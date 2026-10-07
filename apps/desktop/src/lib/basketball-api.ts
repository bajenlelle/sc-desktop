/**
 * League catalogue + game data for the importer, backed by the Genius Sports
 * Warehouse API through the `genius` edge function (see
 * supabase/functions/genius — it holds the API key and caches every response;
 * this module never talks to a league site or to Genius directly).
 *
 * A Genius "competition" IS a league-season, so each Season carries one
 * competitionId and adding next season is a single array entry here plus the
 * same id in the edge function's allowlist.
 */

import { createClient } from "@/lib/supabase/client";
import { getGeniusFixtures, getGeniusMatch } from "@scoutable/shared/lib/genius-client";
import {
  buildRosters,
  findTipoff,
  fixtureToScheduleGame,
  playableFixtures,
  homeCompetitor,
  normalizeGeniusActions,
  type ScheduleGame,
} from "@scoutable/shared/lib/genius";
import type { PlayByPlayEvent } from "@/types/match";
import { PLAYOFF, REGULAR, type League, type Season, type Stage } from "@scoutable/shared/types/league";

export type { ScheduleGame };
export type { League, Season, Stage };

const season = (id: string, label: string, competitionId: number): Season => ({
  id,
  label,
  competitionId,
  stages: [REGULAR, PLAYOFF],
});

/**
 * Fallback catalogue, NOT the source of truth — that lives in the `genius`
 * edge function and arrives via useLeagues(). This copy is what the picker
 * shows before the first successful fetch, and whenever one fails: an empty
 * league list would be a worse outcome than a slightly stale one.
 *
 * It only needs refreshing when it drifts far enough to be misleading; a new
 * season reaches users through a function deploy, with no desktop release.
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

// Placeholder leagues for national team coaches — fill in the season handles
// once the data source (provider TBD) is decided.
const NT_PLACEHOLDER_SEASONS: Season[] = [
  { id: "current", label: "Current", stages: [{ id: "regular", label: "All games" }] },
];

// NOTE: keep these ids in sync with NT_LEAGUE_IDS in
// packages/shared/lib/plan-tier.ts — that list is what exempts a match from
// the monthly club-import cap.
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

/** Regional-indicator flag emoji for an ISO-2 code — no image assets needed. */
export function countryFlag(code: string): string {
  if (code.length !== 2) return "";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

// A competition's playable games, kept for a few minutes per app session, so
// switching stage or between "Your games" and "All games" doesn't refetch.
// The genius function caches upstream for 6 h either way.
const SCHEDULE_TTL_MS = 5 * 60 * 1000;
const scheduleCache = new Map<number, { at: number; games: Promise<ScheduleGame[]> }>();

function playableSchedule(competitionId: number): Promise<ScheduleGame[]> {
  const hit = scheduleCache.get(competitionId);
  if (hit && Date.now() - hit.at < SCHEDULE_TTL_MS) return hit.games;
  const games = (async () => {
    const res = await getGeniusFixtures(createClient(), competitionId);
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
 * every stage — the "Your games" view merges regular season and playoffs.
 */
export async function getLeagueSchedule(
  _league: League,
  season: Season,
  stage: Stage | null,
): Promise<ScheduleGame[]> {
  if (!season.competitionId) return [];
  const games = await playableSchedule(season.competitionId);
  return stage?.matchType ? games.filter((g) => g.matchType === stage.matchType) : games;
}

export interface GeniusGameData {
  homeName: string;
  awayName: string;
  /** YYYY-MM-DD, from the fixture's UTC start time. */
  date: string;
  homeRoster: Array<{ jerseyNumber: string; playerName: string }>;
  awayRoster: Array<{ jerseyNumber: string; playerName: string }>;
  events: PlayByPlayEvent[];
  tipoffRealWorldTime: string | null;
  /** "empty" = the match exists but carries no play-by-play upstream. */
  pbpStatus: "ok" | "empty";
}

/**
 * Everything the import flow needs for one game: names, date, rosters,
 * normalized events and the Q1 tipoff wall-clock for the sync hint.
 * One edge-function call; cached server-side, so re-imports are free.
 */
export async function fetchGameData(
  season: Season,
  game: ScheduleGame,
): Promise<GeniusGameData> {
  if (!season.competitionId) throw new Error("League has no data source configured");
  const res = await getGeniusMatch(createClient(), season.competitionId, Number(game.uuid));
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
    pbpStatus,
  };
}
