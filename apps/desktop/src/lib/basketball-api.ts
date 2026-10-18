/**
 * Desktop wrapper: binds the platform Supabase client to the shared league
 * schedule module. All logic lives in @scoutable/shared/lib/league-schedule
 * (the web importer uses the same functions).
 */
import { createClient } from "@/lib/supabase/client";
import * as schedule from "@scoutable/shared/lib/league-schedule";
import type { League, Season, Stage } from "@scoutable/shared/types/league";
import type { ScheduleGame } from "@scoutable/shared/lib/genius";

export { BUNDLED_LEAGUES, COUNTRY_NAMES, NATIONAL_TEAM_LEAGUES, countryFlag } from "@scoutable/shared/lib/league-schedule";
export type { GameData, GeniusGameData } from "@scoutable/shared/lib/league-schedule";
export type { League, Season, Stage, ScheduleGame };

const c = () => createClient();

export const getSeasonStages = (league: League, season: Season) => schedule.getSeasonStages(c(), league, season);
export const getLeagueSchedule = (league: League, season: Season, stage: Stage | null) =>
  schedule.getLeagueSchedule(c(), league, season, stage);
export const fetchGameData = (season: Season, game: ScheduleGame, stage?: Stage | null) =>
  schedule.fetchGameData(c(), season, game, stage);
