/**
 * Reads a game's marks from the league feed and keeps them on the game
 * (`matches.game_marks`). The game view calls it when a game is opened: the
 * import stores only the plays, so a game has no marks until someone looks at
 * it. One call to the genius function, which answers from its cache for any
 * game that was ever imported (no import allowance is touched; Genius itself
 * is asked only when that game's cache is cold). Never run it as a sweep over
 * a library: staging and production share Genius's monthly quota.
 *
 * The game view is the only writer for now. The importer writes them itself
 * once feat/cloud-game-videos has merged (the importer is where the branches
 * differ), and an import must never fail on a column that isn't there yet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameMarks } from "../types/game-marks";
import type { StoredMatch } from "../types/match";
import { findGeniusGameMarks, gameMarksBasis, gameMarksStale } from "./game-marks";
import { homeCompetitor } from "./genius";
import { getGeniusMatch } from "./genius-client";
import { matchProvider } from "./provider";

/**
 * How a fill ended.
 *   fresh    the stored marks still match the plays; nothing was asked.
 *   skipped  not a game the league feed can answer for (the sample game, an
 *            older import with no feed id, another provider, an unknown season).
 *   filled   read and stored.
 *   unsaved  read, but not stored (not the game's owner, or a database the
 *            migration hasn't reached): good for this visit only.
 *   failed   the feed couldn't be read; `error` is the function's token.
 */
export type GameMarksFillOutcome = "fresh" | "skipped" | "filled" | "unsaved" | "failed";

export interface GameMarksFill {
  outcome: GameMarksFillOutcome;
  /** The marks to draw: the new ones, or what the game already had. */
  marks: GameMarks | null;
  error?: string;
}

type FillMatch = Pick<StoredMatch, "id" | "events" | "gameMarks" | "isDemo" | "sourceGameId" | "leagueId">;

/** The game's id in the Genius feed, when it is a Genius game with one. */
export function geniusGameId(match: Pick<StoredMatch, "isDemo" | "sourceGameId" | "leagueId">): number | null {
  if (match.isDemo || matchProvider(match) !== "genius") return null;
  const id = match.sourceGameId ?? "";
  return /^\d+$/.test(id) ? Number(id) : null;
}

/**
 * Stores a game's marks. True when the row took them; false when the update
 * touched no row (RLS: not this user's game). Throws when the database
 * refuses, which includes one without the column.
 */
export async function updateGameMarks(supabase: SupabaseClient, matchId: string, marks: GameMarks | null): Promise<boolean> {
  const { data, error } = await supabase.from("matches").update({ game_marks: marks }).eq("id", matchId).select("id");
  if (error) throw new Error(`Failed to save game marks: ${error.message}`);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/**
 * Brings a game's marks up to date. `competitionId` is the Genius competition
 * of the game's season (the league catalogue's), or null when it has none.
 * Never throws: a game view without timeouts is still a game view.
 */
export async function fillGameMarks(
  supabase: SupabaseClient,
  match: FillMatch,
  competitionId: number | null,
): Promise<GameMarksFill> {
  const had = match.gameMarks ?? null;
  if (!gameMarksStale(had, match.events)) return { outcome: "fresh", marks: had };
  const gameId = geniusGameId(match);
  if (gameId === null || competitionId === null) return { outcome: "skipped", marks: had };

  let marks: GameMarks;
  try {
    const res = await getGeniusMatch(supabase, competitionId, gameId);
    if (!res.ok) return { outcome: "failed", marks: had, error: res.error };
    const home = homeCompetitor(res.data.fixture);
    if (!home) return { outcome: "failed", marks: had, error: "no_home_team" };
    // A feed with no plays gives empty marks, stored like any others, so the
    // game isn't asked about again.
    marks = { ...findGeniusGameMarks(res.data.actions ?? [], home.teamId), basis: gameMarksBasis(match.events) };
  } catch (e) {
    return { outcome: "failed", marks: had, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const saved = await updateGameMarks(supabase, match.id, marks);
    return { outcome: saved ? "filled" : "unsaved", marks };
  } catch (e) {
    return { outcome: "unsaved", marks, error: e instanceof Error ? e.message : String(e) };
  }
}
