/**
 * Client for the `genius` edge function — the only road to Genius Sports data.
 *
 * The function holds the GENIUS_API_KEY (never shipped to clients), enforces a
 * competition allowlist, and caches responses server-side, so repeat calls for
 * the same fixture list or match cost no upstream quota. JWT-authed like
 * report-issue; the invoke pattern and error-token handling mirror feedback.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeniusAction, GeniusFixture, GeniusPlayer } from "./genius";

export interface GeniusMatchData {
  fixture: GeniusFixture;
  actions: GeniusAction[];
  players: GeniusPlayer[];
  /** "empty" = the match exists but carries no play-by-play upstream. */
  pbpStatus: "ok" | "empty";
}

export type GeniusResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function invokeGenius<T>(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<GeniusResult<T>> {
  const { data, error } = await supabase.functions.invoke("genius", { body });
  if (error) {
    // FunctionsHttpError carries the response; surface the snake token when present.
    let token = "request_failed";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        token = (await ctx.json())?.error ?? token;
      } catch {
        // keep generic token
      }
    }
    return { ok: false, error: token };
  }
  return { ok: true, data: data as T };
}

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
