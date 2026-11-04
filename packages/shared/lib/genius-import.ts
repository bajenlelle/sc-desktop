/**
 * Importing a league game: its data from the Genius Sports proxy (the
 * `genius` edge function, which holds the API key and caches), the match an
 * import saves (the sync built from the picker's answers, carried over from
 * an earlier import of the same video), and the save itself. The quota is
 * the database's: the import trigger raises `import_limit_reached`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PeriodSync, PlayByPlayEvent, StoredMatch, SyncPoint } from "../types/match";
import {
  buildRosters,
  findGeniusPeriodMarks,
  findTipoff,
  fixtureToScheduleGame,
  homeCompetitor,
  normalizeGeniusActions,
  type ScheduleGame,
} from "./genius";
import { getGeniusMatch } from "./genius-client";
import { saveMatch } from "./matches-db";
import { carrySyncOver } from "./period-sync";
import { clearLegacyShippedClipsForMatch } from "./playlists-db";
import { reportDbError } from "./report";

export type { ScheduleGame };
export { fixtureToScheduleGame };

export interface GeniusGameData {
  homeName: string;
  awayName: string;
  /** YYYY-MM-DD, from the fixture's UTC start time. */
  date: string;
  homeRoster: Array<{ jerseyNumber: string; playerName: string }>;
  awayRoster: Array<{ jerseyNumber: string; playerName: string }>;
  events: PlayByPlayEvent[];
  tipoffRealWorldTime: string | null;
  /**
   * Each period's reference times from the league (start, end, and what to
   * look for in the video), saved on the sync point so a video that skips
   * the breaks can be synced quarter by quarter, now or later.
   */
  periodMarks?: SyncPoint["marks"];
  /** "empty" = the match exists but carries no play-by-play upstream. */
  pbpStatus: "ok" | "empty";
}

/**
 * Everything an import needs for one game: names, date, rosters, normalized
 * events and the Q1 tip-off wall-clock for the sync hint. One edge-function
 * call; cached server-side, so re-imports are free.
 */
export async function loadGeniusGame(sb: SupabaseClient, competitionId: number, game: ScheduleGame): Promise<GeniusGameData> {
  const res = await getGeniusMatch(sb, competitionId, Number(game.uuid));
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

export interface ImportInput {
  /** The existing import's id on a re-import, else a fresh one. */
  id: string;
  /** The league API's stable game uuid: stable across re-imports, dedupes the quota log. */
  sourceGameId?: string;
  title: string;
  /** YYYY-MM-DD. */
  date: string;
  homeTeam: { name: string; color: string };
  awayTeam: { name: string; color: string };
  homeRoster: StoredMatch["homeRoster"];
  awayRoster: StoredMatch["awayRoster"];
  /** The video's local path, or none yet. */
  videoUrl: string | null;
  events: PlayByPlayEvent[];
  leagueId: string;
  seasonId?: string;
  stageId?: string;
  orgId?: string;
  /** The tip-off in the video, or none set. */
  syncSeconds: number | null;
  tipoffRealWorldTime: string | null;
  periodMarks?: SyncPoint["marks"];
  /** Whether the video skips the breaks (the switch as it stands), and the coach's own answer: null = never answered. */
  breaksCut: boolean;
  breaksCutChoice: boolean | null;
  /** The quarters set during the import. */
  periodSyncs: Record<string, PeriodSync>;
  /** The earlier import of this game, when it is one. */
  existing: { syncPoint?: SyncPoint; videoUrl?: string } | null;
}

/**
 * The match an import saves. Its sync is built from the picker's answers:
 * the league's marks are kept even for a video that holds the whole game
 * (the quarters can still be synced later), `breaksCut` is true with its
 * quarters, false when the coach said so, absent when never asked. A
 * re-import onto the same video keeps the quarters and cuts already fixed.
 */
export function importedMatch(input: ImportInput): StoredMatch {
  let syncPoint: SyncPoint | undefined;
  if (input.syncSeconds !== null) {
    syncPoint = {
      syncVideoTime: input.syncSeconds,
      syncRealWorldTime: input.tipoffRealWorldTime ?? "",
      ...(input.periodMarks && Object.keys(input.periodMarks).length > 0 ? { marks: input.periodMarks } : {}),
      ...(input.breaksCut
        ? { breaksCut: true, ...(Object.keys(input.periodSyncs).length > 0 ? { periods: input.periodSyncs } : {}) }
        : input.breaksCutChoice === false
          ? { breaksCut: false }
          : {}),
    };
    syncPoint = carrySyncOver(input.existing?.syncPoint, syncPoint, !!input.videoUrl && input.existing?.videoUrl === input.videoUrl);
  }
  return {
    id: input.id,
    sourceGameId: input.sourceGameId,
    title: input.title,
    date: input.date,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    homeRoster: input.homeRoster,
    awayRoster: input.awayRoster,
    videoUrl: input.videoUrl ?? undefined,
    syncPoint,
    events: input.events,
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    stageId: input.stageId,
    orgId: input.orgId,
  };
}

/**
 * Saves the match; a re-import refreshes its plays in place (the league may
 * have corrected them; clips keep working, keyed on match and event). When a
 * re-import can move the sync, uploads that can't say where they were cut
 * stop being served; the host lets the rest follow (afterSyncChange).
 */
export async function importGame(
  sb: SupabaseClient,
  match: StoredMatch,
  existing: { syncPoint?: SyncPoint } | null,
): Promise<{ syncChanged: boolean }> {
  await saveMatch(sb, match, { refreshEvents: !!existing });
  const syncChanged = !!(existing?.syncPoint && match.syncPoint);
  if (syncChanged) {
    void clearLegacyShippedClipsForMatch(sb, match.id).catch((e) =>
      reportDbError("clearLegacyShippedClipsForMatch", { message: e instanceof Error ? e.message : String(e) }),
    );
  }
  return { syncChanged };
}
