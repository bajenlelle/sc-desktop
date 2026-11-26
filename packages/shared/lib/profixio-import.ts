/**
 * Importing a Profixio game (SBBF district leagues and youth SM; docs/profixio.md):
 * a season's categories, its played games, and one game's data, through the
 * `profixio` edge function, in the shapes the Genius import uses, so the
 * import flow downstream of ScheduleGame and GeniusGameData doesn't care
 * which provider a game came from.
 *
 * The sync reference is the first made basket, not the tip-off: the table
 * presses "Start period 1" when it opens the protocol, minutes before the
 * jump ball (measured 3:37 to 4:00), so the protocol has no tip-off time to
 * offer. A basket is what a coach can find in the video, and the importer asks
 * for one (components/first-basket.tsx).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { League, Season, Stage } from "../types/league";
import type { ScheduleGame } from "./genius";
import type { GeniusGameData } from "./genius-import";
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
import { getProfixioCategories, getProfixioMatch, getProfixioSchedule } from "./profixio-client";

const byNewest = (a: ScheduleGame, b: ScheduleGame) => Date.parse(b.rawStartDateTime) - Date.parse(a.rawStartDateTime);

/** One fetch per Profixio league for the app session: the catalogue's refreshes churn object identity. */
const stagesByLeague = new Map<number, Promise<Stage[]>>();

/** A Profixio season's stages: the league's categories ("Nivå 1", "Nivå 2A"…). */
export function getProfixioStages(sb: SupabaseClient, league: League, season: Season): Promise<Stage[]> {
  const leagueId = season.profixio?.leagueId;
  if (!leagueId) return Promise.resolve([]);
  let pending = stagesByLeague.get(leagueId);
  if (!pending) {
    pending = getProfixioCategories(sb, leagueId).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch categories: ${res.error}`);
      return categoriesToStages(res.data.categories, league.name);
    });
    // A failure is retried next time.
    pending.catch(() => stagesByLeague.delete(leagueId));
    stagesByLeague.set(leagueId, pending);
  }
  return pending;
}

/** A category's played games, newest first: the protocol fills in during the game, so an unplayed one can't become clips. */
export async function loadProfixioSchedule(sb: SupabaseClient, season: Season, stage: Stage | null): Promise<ScheduleGame[]> {
  if (!season.profixio || stage?.categoryId == null) return [];
  const res = await getProfixioSchedule(sb, season.profixio.leagueId, stage.categoryId);
  if (!res.ok) throw new Error(`Failed to fetch schedule: ${res.error}`);
  return res.data.rows.filter((r) => r.hasResult).map(profixioRowToScheduleGame).sort(byNewest);
}

/**
 * One game's data. `tipoffRealWorldTime` is the first made basket (the
 * start marker when nobody scored). Period 1 keeps no start time: it is the
 * table's early press, and a Q1 that starts minutes before the jump ball
 * would stretch the game's first quarter over the warm-up.
 */
export async function loadProfixioGame(sb: SupabaseClient, season: Season, stage: Stage | null, game: ScheduleGame): Promise<GeniusGameData> {
  const matchId = parseProfixioSourceGameId(game.uuid);
  if (!season.profixio || matchId == null || stage?.categoryId == null) throw new Error("League has no data source configured");
  const res = await getProfixioMatch(sb, season.profixio.leagueId, stage.categoryId, matchId);
  if (!res.ok) throw new Error(`Failed to fetch game data: ${res.error}`);
  const m = res.data;
  const homeName = game.homeTeamInfo.names.long;
  const awayName = game.awayTeamInfo.names.long;
  const ctx = { homeName, awayName };
  const rosters = buildProfixioRosters(m.lineup, resolveSides(m));
  const events = normalizeProfixioEvents(m, ctx);
  const anchor = findProfixioSyncAnchor(m, ctx);
  const marks = findProfixioPeriodMarks(m, ctx);
  if (marks["1"]) {
    const { startRealWorldTime: _early, ...q1 } = marks["1"];
    marks["1"] = q1;
  }
  return {
    homeName,
    awayName,
    date: game.rawStartDateTime.slice(0, 10),
    homeRoster: rosters.home,
    awayRoster: rosters.away,
    events,
    tipoffRealWorldTime: anchor?.realWorldTime ?? null,
    periodMarks: marks,
    pbpStatus: events.length > 0 ? "ok" : "empty",
  };
}
