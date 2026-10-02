/**
 * League catalogue + game data for the importer, behind two providers and
 * two edge functions (this module never talks to a league site directly):
 *   - Genius Sports (SBF's national leagues) through `genius`, which holds
 *     the API key and caches every response. A Genius "competition" IS a
 *     league-season, so each Season carries one competitionId.
 *   - Profixio (SBBF district basketball) through `profixio`, which reads
 *     the public pages today and the documented API once a token exists. A
 *     Profixio season carries a league handle; its stages are the league's
 *     categories, fetched once the season is selected.
 * Everything downstream of ScheduleGame / GameData is provider-blind.
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
import { getProfixioCategories, getProfixioMatch, getProfixioSchedule } from "@scoutable/shared/lib/profixio-client";
import {
  buildProfixioRosters,
  categoriesToStages,
  findProfixioSyncAnchor,
  normalizeProfixioEvents,
  parseProfixioSourceGameId,
  profixioRowToScheduleGame,
  resolveSides,
} from "@scoutable/shared/lib/profixio";
import { seasonProvider } from "@scoutable/shared/lib/provider";
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

const byNewest = (a: ScheduleGame, b: ScheduleGame) =>
  new Date(b.rawStartDateTime).getTime() - new Date(a.rawStartDateTime).getTime();

/** One in-flight/settled categories fetch per Profixio league id — the catalogue refreshes churn object identity. */
const profixioStages = new Map<number, Promise<Stage[]>>();

/**
 * The stages the Stage dropdown offers for a season. Genius seasons carry
 * theirs (regular season / playoffs); a Profixio season's stages are the
 * league's categories ("Nivå 1", "Nivå 2A", …), fetched from the function.
 */
export function getSeasonStages(league: League, season: Season): Promise<Stage[]> {
  if (seasonProvider(season) !== "profixio") return Promise.resolve(season.stages);
  const leagueId = season.profixio?.leagueId;
  if (!leagueId) return Promise.resolve([]);
  let pending = profixioStages.get(leagueId);
  if (!pending) {
    pending = getProfixioCategories(createClient(), leagueId).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch categories: ${res.error}`);
      return categoriesToStages(res.data.categories, league.name);
    });
    pending.catch(() => profixioStages.delete(leagueId));
    profixioStages.set(leagueId, pending);
  }
  return pending;
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
  if (seasonProvider(season) === "profixio") {
    if (!season.profixio || stage.categoryId == null) return [];
    const res = await getProfixioSchedule(createClient(), season.profixio.leagueId, stage.categoryId);
    if (!res.ok) throw new Error(`Failed to fetch schedule: ${res.error}`);
    // Only played games: the protocol fills in during the game, so an
    // unplayed row can't become clips yet.
    return res.data.rows.filter((r) => r.hasResult).map(profixioRowToScheduleGame).sort(byNewest);
  }

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
    .sort(byNewest);
}

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
  season: Season,
  game: ScheduleGame,
  stage?: Stage | null,
): Promise<GameData> {
  if (seasonProvider(season) === "profixio") {
    const matchId = parseProfixioSourceGameId(game.uuid);
    if (!season.profixio || matchId == null || stage?.categoryId == null) {
      throw new Error("League has no data source configured");
    }
    const res = await getProfixioMatch(createClient(), season.profixio.leagueId, stage.categoryId, matchId);
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
      pbpStatus: events.length > 0 ? "ok" : "empty",
    };
  }

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
