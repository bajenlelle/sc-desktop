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
  homeCompetitor,
  normalizeGeniusActions,
  type ScheduleGame,
} from "@scoutable/shared/lib/genius";
import type { PlayByPlayEvent } from "@/types/match";

export type { ScheduleGame };

/** A phase within a season — regular season or playoffs. */
export interface Stage {
  id: string;
  label: string;
  /** Genius matchType this stage maps to; undefined = no filter (all games). */
  matchType?: "REGULAR" | "FINALS";
}

/**
 * One season of a league. A season carries its Genius competitionId, so
 * adding next season is a single array entry (mirror the id in
 * supabase/functions/genius COMPETITIONS).
 */
export interface Season {
  id: string;
  label: string;
  competitionId?: number;
  stages: Stage[];
}

export interface League {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 — drives grouping and the flag in the picker. */
  country: string;
  gender?: "men" | "women";
  /** Ordered newest-first; seasons[0] is treated as the current season. */
  seasons: Season[];
}

const REGULAR: Stage = { id: "regular", label: "Regular season", matchType: "REGULAR" };
const PLAYOFF: Stage = { id: "playoff", label: "Playoffs", matchType: "FINALS" };

const season = (id: string, label: string, competitionId: number): Season => ({
  id,
  label,
  competitionId,
  stages: [REGULAR, PLAYOFF],
});

export const LEAGUES: League[] = [
  {
    id: "sbl-herr",
    name: "SBL Herr",
    country: "SE",
    gender: "men",
    seasons: [season("2025-26", "2025/26", 41539)],
  },
  {
    id: "sbl-dam",
    name: "SBL Dam",
    country: "SE",
    gender: "women",
    seasons: [season("2025-26", "2025/26", 42013)],
  },
  {
    id: "superettan-herr",
    name: "Superettan Herr",
    country: "SE",
    gender: "men",
    seasons: [season("2025-26", "2025/26", 42132)],
  },
  {
    id: "basketettan-herr",
    name: "Basketettan Herr",
    country: "SE",
    gender: "men",
    seasons: [season("2025-26", "2025/26", 42251)],
  },
  {
    id: "basketettan-dam",
    name: "Basketettan Dam",
    country: "SE",
    gender: "women",
    seasons: [season("2025-26", "2025/26", 42250)],
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

/**
 * Playable schedule for a league season stage, newest first. Only COMPLETE
 * games that actually carry play-by-play (statsSource set) are shown —
 * anything else can't become clips, so coaches never see it.
 */
export async function getLeagueSchedule(
  _league: League,
  season: Season,
  stage: Stage,
): Promise<ScheduleGame[]> {
  if (!season.competitionId) return [];
  const res = await getGeniusFixtures(createClient(), season.competitionId);
  if (!res.ok) throw new Error(`Failed to fetch fixtures: ${res.error}`);

  return res.data.fixtures
    .filter(
      (f) =>
        f.matchStatus === "COMPLETE" &&
        f.statsSource !== "" &&
        (!stage.matchType || f.matchType === stage.matchType),
    )
    .map(fixtureToScheduleGame)
    .sort(
      (a, b) => new Date(b.rawStartDateTime).getTime() - new Date(a.rawStartDateTime).getTime(),
    );
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
