/**
 * Client for the `profixio` edge function — the only road to Profixio data.
 *
 * The function reads Profixio's public pages today and switches to the
 * documented API (and holds its PROFIXIO_API_SECRET) the moment the secret is
 * set; either way it caches server-side and serves the shapes in
 * profixio-wire.ts, so this client never knows which. JWT-authed like genius;
 * invocation and error-token handling live in edge-function.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction, type FunctionResult } from "./edge-function";
import type {
  ProfixioCategoriesResponse,
  ProfixioLeaguesResponse,
  ProfixioMatchResponse,
  ProfixioScheduleResponse,
} from "./profixio-wire";

export type ProfixioResult<T> = FunctionResult<T>;

const invokeProfixio = <T>(supabase: SupabaseClient, body: Record<string, unknown>) =>
  invokeEdgeFunction<T>(supabase, "profixio", body);

/** Every district league the function has discovered, in the catalogue shape the picker renders. */
export function getProfixioLeagues(supabase: SupabaseClient): Promise<ProfixioResult<ProfixioLeaguesResponse>> {
  return invokeProfixio(supabase, { action: "leagues" });
}

/** A league-season's categories ("Nivå 1", "Nivå 2A", …) — the picker's stages. */
export function getProfixioCategories(
  supabase: SupabaseClient,
  leagueId: number,
): Promise<ProfixioResult<ProfixioCategoriesResponse>> {
  return invokeProfixio(supabase, { action: "categories", leagueId });
}

/** Every match of one category, played or not. */
export function getProfixioSchedule(
  supabase: SupabaseClient,
  leagueId: number,
  categoryId: number,
): Promise<ProfixioResult<ProfixioScheduleResponse>> {
  return invokeProfixio(supabase, { action: "schedule", leagueId, categoryId });
}

/** Full match payload: events (oldest first), lineup, event types and sides. */
export function getProfixioMatch(
  supabase: SupabaseClient,
  leagueId: number,
  categoryId: number,
  matchId: number,
): Promise<ProfixioResult<ProfixioMatchResponse>> {
  return invokeProfixio(supabase, { action: "match", leagueId, categoryId, matchId });
}
