/**
 * Client for the `genius` edge function — the only road to Genius Sports data.
 *
 * The function holds the GENIUS_API_KEY (never shipped to clients), enforces a
 * competition allowlist, and caches responses server-side, so repeat calls for
 * the same fixture list or match cost no upstream quota. JWT-authed like
 * report-issue; invocation and error-token handling live in edge-function.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction, type FunctionResult } from "./edge-function";
import type { GeniusAction, GeniusFixture, GeniusPlayer } from "./genius";
import type { CatalogLeague } from "../types/league";

export interface GeniusMatchData {
  fixture: GeniusFixture;
  actions: GeniusAction[];
  players: GeniusPlayer[];
  /** "empty" = the match exists but carries no play-by-play upstream. */
  pbpStatus: "ok" | "empty";
}

export type GeniusResult<T> = FunctionResult<T>;

const invokeGenius = <T>(supabase: SupabaseClient, body: Record<string, unknown>) =>
  invokeEdgeFunction<T>(supabase, "genius", body);

/** Fixture list for one competition (a Genius competition IS a league-season). */
export function getGeniusFixtures(
  supabase: SupabaseClient,
  competitionId: number,
): Promise<GeniusResult<{ fixtures: GeniusFixture[] }>> {
  return invokeGenius(supabase, { action: "fixtures", competitionId });
}

/** Full match payload: fixture + raw actions + participants. */
export function getGeniusMatch(
  supabase: SupabaseClient,
  competitionId: number,
  matchId: number,
): Promise<GeniusResult<GeniusMatchData>> {
  return invokeGenius(supabase, { action: "match", competitionId, matchId });
}

/**
 * Platform-admin only: every competition the API key can see, raw and
 * untrimmed. The once-a-season maintenance tool for finding the new season's
 * competition ids (which go into LEAGUES and the function's allowlist).
 */
export function getGeniusCompetitions(
  supabase: SupabaseClient,
): Promise<GeniusResult<{ competitions: Array<Record<string, unknown>> }>> {
  return invokeGenius(supabase, { action: "competitions" });
}

/**
 * The league catalogue the function serves — the same structure it derives its
 * competition allowlist from, so a season the client can select is always one
 * the function will fetch. Clients keep a bundled copy as a fallback; see
 * parseLeagueCatalog before trusting a response or a cached blob.
 */
export function getGeniusLeagues(
  supabase: SupabaseClient,
): Promise<GeniusResult<{ leagues: CatalogLeague[] }>> {
  return invokeGenius(supabase, { action: "leagues" });
}
