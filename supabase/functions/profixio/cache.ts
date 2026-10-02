// Typed access to the four profixio_* cache tables (server-written, RLS with
// no policies — only the service role reaches them) plus the in-isolate
// de-duplication of concurrent identical upstream calls.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type {
  ProfixioCategory,
  ProfixioMatchResponse,
  ProfixioScheduleRow,
} from "../../../packages/shared/lib/profixio-wire.ts";
import type { LeagueDetail } from "./driver.ts";

export const CATALOG_TTL_MS = 24 * 3_600_000;
export const EMPTY_DISTRICT_TTL_MS = 6 * 3_600_000;
export const LEAGUE_TTL_MS = 24 * 3_600_000;
export const SCHEDULE_TTL_MS = 6 * 3_600_000;

export function isStale(fetchedAt: string, ttlMs: number): boolean {
  if (ttlMs === Infinity) return false;
  const t = Date.parse(fetchedAt);
  return !Number.isFinite(t) || Date.now() - t > ttlMs;
}

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

function logError(where: string, error: { message: string } | null): void {
  if (error) console.error(`[profixio] ${where}:`, error.message);
}

// ---------------------------------------------------------------------------
// Catalogue: one row per (district, season)
// ---------------------------------------------------------------------------

export interface CatalogRow {
  district_id: number;
  season_id: number;
  district_name: string;
  season_label: string;
  payload: Array<{ leagueId: number; name: string }>;
  fetched_at: string;
}

export async function readCatalogRows(admin: Admin): Promise<CatalogRow[]> {
  const { data, error } = await admin.from("profixio_catalog_cache").select("*");
  logError("catalog read failed", error);
  return (data ?? []) as CatalogRow[];
}

export async function upsertCatalogRow(admin: Admin, row: Omit<CatalogRow, "fetched_at">): Promise<void> {
  const { error } = await admin
    .from("profixio_catalog_cache")
    .upsert({ ...row, fetched_at: new Date().toISOString() }, { onConflict: "district_id,season_id" });
  logError("catalog upsert failed", error);
}

// ---------------------------------------------------------------------------
// League detail
// ---------------------------------------------------------------------------

export interface LeagueRow {
  league_id: number;
  name: string;
  district_id: number | null;
  tournament_id: number | null;
  season_id: number | null;
  categories: ProfixioCategory[];
  fetched_at: string;
}

export async function readLeague(admin: Admin, leagueId: number): Promise<LeagueRow | null> {
  const { data, error } = await admin.from("profixio_league_cache").select("*").eq("league_id", leagueId).maybeSingle();
  logError("league read failed", error);
  return (data as LeagueRow | null) ?? null;
}

export async function upsertLeague(admin: Admin, detail: LeagueDetail): Promise<string> {
  const fetched_at = new Date().toISOString();
  const { error } = await admin.from("profixio_league_cache").upsert(
    {
      league_id: detail.leagueId,
      name: detail.name,
      district_id: detail.districtId,
      tournament_id: detail.tournamentId,
      season_id: detail.seasonId,
      categories: detail.categories,
      fetched_at,
    },
    { onConflict: "league_id" },
  );
  logError("league upsert failed", error);
  return fetched_at;
}

export function leagueRowToDetail(row: LeagueRow): LeagueDetail {
  return {
    leagueId: row.league_id,
    name: row.name,
    districtId: row.district_id,
    tournamentId: row.tournament_id,
    seasonId: row.season_id,
    categories: row.categories ?? [],
  };
}

// ---------------------------------------------------------------------------
// Schedule per (league, category)
// ---------------------------------------------------------------------------

export interface ScheduleRow {
  league_id: number;
  category_id: number;
  payload: ProfixioScheduleRow[];
  partial: boolean;
  fetched_at: string;
}

export async function readSchedule(admin: Admin, leagueId: number, categoryId: number): Promise<ScheduleRow | null> {
  const { data, error } = await admin
    .from("profixio_schedule_cache")
    .select("*")
    .eq("league_id", leagueId)
    .eq("category_id", categoryId)
    .maybeSingle();
  logError("schedule read failed", error);
  return (data as ScheduleRow | null) ?? null;
}

export async function upsertSchedule(
  admin: Admin,
  leagueId: number,
  categoryId: number,
  rows: ProfixioScheduleRow[],
  partial: boolean,
): Promise<string> {
  const fetched_at = new Date().toISOString();
  const { error } = await admin
    .from("profixio_schedule_cache")
    .upsert({ league_id: leagueId, category_id: categoryId, payload: rows, partial, fetched_at }, { onConflict: "league_id,category_id" });
  logError("schedule upsert failed", error);
  return fetched_at;
}

// ---------------------------------------------------------------------------
// Match payloads
// ---------------------------------------------------------------------------

export type StoredMatch = Omit<ProfixioMatchResponse, "schedule" | "fetchedAt">;

export interface MatchRow {
  match_id: number;
  league_id: number;
  category_id: number | null;
  payload: StoredMatch;
  state: string;
  final: boolean;
  pbp_status: "ok" | "empty";
  source: "public" | "api";
  schema_version: number;
  fetched_at: string;
}

export async function readMatch(admin: Admin, matchId: number): Promise<MatchRow | null> {
  const { data, error } = await admin.from("profixio_match_cache").select("*").eq("match_id", matchId).maybeSingle();
  logError("match read failed", error);
  return (data as MatchRow | null) ?? null;
}

export async function upsertMatch(admin: Admin, body: StoredMatch): Promise<string> {
  const fetched_at = new Date().toISOString();
  // Concurrent imports of the same match may both reach here; the upsert
  // makes the double-fetch harmless (last write wins, identical data).
  const { error } = await admin.from("profixio_match_cache").upsert(
    {
      match_id: body.matchId,
      league_id: body.leagueId,
      category_id: body.categoryId,
      payload: body,
      state: body.state,
      final: body.final,
      pbp_status: body.pbpStatus,
      source: body.source,
      schema_version: body.schemaVersion,
      fetched_at,
    },
    { onConflict: "match_id" },
  );
  logError("match upsert failed", error);
  return fetched_at;
}

// ---------------------------------------------------------------------------
// In-isolate de-duplication
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<unknown>>();

/** Share one upstream call between concurrent identical requests in this isolate. */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
