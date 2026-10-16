// Scoutable — Profixio proxy Edge Function (SBBF district basketball).
// Called from the desktop importer via supabase.functions.invoke; the
// function authenticates every request itself (verify_jwt = false in
// config.toml, same reasoning as genius). Four actions, all cached in the
// profixio_* tables (migration 20261002100000):
//   { action: "leagues" }                                → the accessible tournaments, catalogue shape
//   { action: "categories", leagueId }                   → a league-season's categories (= stages)
//   { action: "schedule", leagueId, categoryId }         → the category's matches
//   { action: "match", leagueId, categoryId, matchId }   → events + lineup + sides
// Upstream is Profixio's documented API (driver-api.ts), read with the
// PROFIXIO_API_SECRET key; it serves the shapes in
// packages/shared/lib/profixio-wire.ts. Normalisation to PlayByPlayEvent
// happens client-side (packages/shared/lib/profixio.ts).

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  PROFIXIO_MATCH_SCHEMA_VERSION,
  composeCatalog,
  groupTournaments,
  isFinal,
  matchCacheTtlMs,
  type ProfixioCategoriesResponse,
  type ProfixioLeaguesResponse,
  type ProfixioMatchResponse,
  type ProfixioScheduleResponse,
  type ProfixioScheduleRow,
} from "../../../packages/shared/lib/profixio-wire.ts";
import * as cache from "./cache.ts";
import type { CatalogTournament, LeagueDetail, ProfixioDriver } from "./driver.ts";
import { createApiDriver } from "./driver-api.ts";
import { ClientError, ParseError, Upstream } from "./upstream.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PROFIXIO_API_SECRET = Deno.env.get("PROFIXIO_API_SECRET") ?? "";

/** A cold catalogue is 1 userinfo call + one per tournament (17 today). */
const MAX_FETCHES = 48;
const REQUEST_DEADLINE_MS = 90_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey",
};

function err(status: number, token: string): Response {
  return new Response(JSON.stringify({ error: token }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Run after the response is sent when the runtime supports it; never let it reject. */
function background(p: Promise<unknown>): void {
  const safe = p.catch((e) => console.error("[profixio] background task failed:", e instanceof Error ? e.message : String(e)));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) EdgeRuntime.waitUntil(safe);
}

const driver: ProfixioDriver | null = PROFIXIO_API_SECRET ? createApiDriver(PROFIXIO_API_SECRET) : null;

type Admin = cache.Admin;

/** The API driver; without PROFIXIO_API_SECRET there is no upstream at all. */
function api(): ProfixioDriver {
  if (!driver) throw new ClientError(500, "server_misconfigured");
  return driver;
}

function positiveInt(v: unknown, token: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw new ClientError(400, token);
  return n;
}

function newUpstream(): Upstream {
  return new Upstream({ maxFetches: MAX_FETCHES, deadlineMs: REQUEST_DEADLINE_MS });
}

// ---------------------------------------------------------------------------
// leagues
// ---------------------------------------------------------------------------

/** One catalogue row per (district, season); district 0 holds the national tournaments. */
function catalogRows(tournaments: CatalogTournament[]): Array<Omit<cache.CatalogRow, "fetched_at">> {
  return groupTournaments(tournaments).map((r) => ({
    district_id: r.districtId,
    season_id: r.seasonId,
    district_name: r.districtName,
    season_label: r.seasonLabel,
    payload: r.leagues,
  }));
}

/** Rows the old public-page crawler wrote carry no tournamentId and can't be read through the API. */
function isApiCatalog(rows: cache.CatalogRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.payload.every((l) => typeof l.tournamentId === "number" && l.tournamentId > 0));
}

async function refreshCatalog(admin: Admin, up: Upstream): Promise<{ rows: cache.CatalogRow[]; complete: boolean }> {
  const { tournaments, complete } = await api().listTournaments(up);
  // Never let a partial read shrink the picker: keep the old rows until a full one.
  if (!complete && tournaments.length === 0) throw new ClientError(503, "catalog_unavailable");
  if (!complete) {
    const existing = await cache.readCatalogRows(admin);
    if (isApiCatalog(existing)) return { rows: existing, complete };
  }
  return { rows: await cache.replaceCatalog(admin, catalogRows(tournaments)), complete };
}

async function leagues(admin: Admin, up: Upstream): Promise<ProfixioLeaguesResponse> {
  let rows = await cache.readCatalogRows(admin);
  let complete = true;
  if (!isApiCatalog(rows)) {
    // Cold (or still the crawler's): read the tournaments now.
    ({ rows, complete } = await cache.dedupe("catalog:cold", () => refreshCatalog(admin, up)));
  } else if (rows.some((r) => cache.isStale(r.fetched_at, cache.CATALOG_TTL_MS))) {
    background(cache.dedupe("catalog:refresh", () => refreshCatalog(admin, newUpstream())));
  }
  return {
    leagues: composeCatalog(
      rows.map((r) => ({
        districtId: r.district_id,
        districtName: r.district_name,
        seasonId: r.season_id,
        seasonLabel: r.season_label,
        leagues: r.payload,
      })),
    ),
    complete,
    fetchedAt: rows.map((r) => r.fetched_at).sort()[0] ?? new Date().toISOString(),
  };
}

/** The accessible tournament behind a league id, from the catalogue (refreshed if it is cold). */
async function tournamentFor(admin: Admin, up: Upstream, leagueId: number): Promise<number> {
  let rows = await cache.readCatalogRows(admin);
  if (!isApiCatalog(rows)) rows = (await cache.dedupe("catalog:cold", () => refreshCatalog(admin, up))).rows;
  for (const r of rows) {
    const hit = r.payload.find((l) => l.leagueId === leagueId);
    if (hit?.tournamentId) return hit.tournamentId;
  }
  throw new ClientError(404, "unknown_league");
}

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

async function ensureLeague(
  admin: Admin,
  up: Upstream,
  leagueId: number,
): Promise<{ detail: LeagueDetail; fetchedAt: string }> {
  // Bounded proxy: only leagues whose tournament the key may view.
  const tournamentId = await tournamentFor(admin, up, leagueId);
  const row = await cache.readLeague(admin, leagueId);
  const current = row && row.tournament_id === tournamentId ? row : null;
  if (current && !cache.isStale(current.fetched_at, cache.LEAGUE_TTL_MS)) {
    return { detail: cache.leagueRowToDetail(current), fetchedAt: current.fetched_at };
  }
  try {
    const detail = await cache.dedupe(`league:${leagueId}`, () => api().leagueDetail(tournamentId, up));
    const fetchedAt = await cache.upsertLeague(admin, detail);
    return { detail, fetchedAt };
  } catch (e) {
    if (current && !(e instanceof ClientError)) {
      console.error(`[profixio] league ${leagueId} refresh failed, serving stale:`, e instanceof Error ? e.message : String(e));
      return { detail: cache.leagueRowToDetail(current), fetchedAt: current.fetched_at };
    }
    throw e;
  }
}

async function categories(admin: Admin, up: Upstream, leagueId: number): Promise<ProfixioCategoriesResponse> {
  const { detail, fetchedAt } = await ensureLeague(admin, up, leagueId);
  return {
    leagueId: detail.leagueId,
    name: detail.name,
    districtId: detail.districtId,
    tournamentId: detail.tournamentId,
    seasonId: detail.seasonId,
    categories: detail.categories,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

async function ensureSchedule(
  admin: Admin,
  up: Upstream,
  league: LeagueDetail,
  categoryId: number,
): Promise<ProfixioScheduleResponse> {
  if (!league.categories.some((c) => c.categoryId === categoryId)) throw new ClientError(404, "unknown_category");
  const key = `schedule:${league.leagueId}:${categoryId}`;
  const row = await cache.readSchedule(admin, league.leagueId, categoryId);
  const base = { leagueId: league.leagueId, categoryId };

  if (row && !cache.isStale(row.fetched_at, cache.SCHEDULE_TTL_MS)) {
    return { ...base, rows: row.payload, partial: row.partial, fetchedAt: row.fetched_at, stale: false };
  }
  if (row) {
    // Stale-while-revalidate: a 6 h-old schedule beats waiting on a 1 MB page.
    background(
      cache.dedupe(key, async () => {
        const res = await api().schedule(league, categoryId, newUpstream());
        await cache.upsertSchedule(admin, league.leagueId, categoryId, res.rows, res.partial);
      }),
    );
    return { ...base, rows: row.payload, partial: row.partial, fetchedAt: row.fetched_at, stale: true };
  }
  const res = await cache.dedupe(key, () => api().schedule(league, categoryId, up));
  const fetchedAt = await cache.upsertSchedule(admin, league.leagueId, categoryId, res.rows, res.partial);
  return { ...base, rows: res.rows, partial: res.partial, fetchedAt, stale: false };
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

function withSchedule(stored: cache.StoredMatch, schedule: ProfixioScheduleRow, fetchedAt: string): ProfixioMatchResponse {
  return { ...stored, schedule, fetchedAt };
}

async function match(
  admin: Admin,
  up: Upstream,
  userId: string,
  leagueId: number,
  categoryId: number,
  matchId: number,
  refresh: boolean,
): Promise<ProfixioMatchResponse> {
  const { detail: league } = await ensureLeague(admin, up, leagueId);
  // The cached schedule row doubles as the existence check — the role the
  // fixture cache plays for genius.
  const schedule = await ensureSchedule(admin, up, league, categoryId);
  const scheduleRow = schedule.rows.find((r) => r.matchId === matchId);
  if (!scheduleRow) throw new ClientError(404, "match_not_available");

  if (refresh) {
    const { data: prof } = await admin.from("profiles").select("is_platform_admin").eq("id", userId).maybeSingle();
    if (!prof?.is_platform_admin) throw new ClientError(403, "not_platform_admin");
  }

  const cached = await cache.readMatch(admin, matchId);
  const usable = cached && cached.schema_version === PROFIXIO_MATCH_SCHEMA_VERSION ? cached : null;
  if (usable && !refresh) {
    const ttl = matchCacheTtlMs({ final: usable.final, pbpStatus: usable.pbp_status, kickoff: scheduleRow.kickoff });
    if (!cache.isStale(usable.fetched_at, ttl)) return withSchedule(usable.payload, scheduleRow, usable.fetched_at);
  }

  try {
    const fetched = await cache.dedupe(`match:${matchId}`, () => api().match(league, categoryId, matchId, up));
    const stored: cache.StoredMatch = {
      schemaVersion: PROFIXIO_MATCH_SCHEMA_VERSION,
      leagueId,
      categoryId,
      matchId,
      homeWebId: fetched.homeWebId,
      awayWebId: fetched.awayWebId,
      matchPeriods: fetched.matchPeriods,
      useMatchClock: fetched.useMatchClock,
      state: fetched.state,
      final: isFinal(fetched.state, fetched.events, scheduleRow.kickoff),
      eventTypes: fetched.eventTypes,
      events: fetched.events,
      lineup: fetched.lineup,
      // 'empty' is a negative cache: paper protocol or not played yet.
      pbpStatus: fetched.events.length > 0 ? "ok" : "empty",
      source: "api",
    };
    const fetchedAt = await cache.upsertMatch(admin, stored);
    return withSchedule(stored, scheduleRow, fetchedAt);
  } catch (e) {
    if (usable) {
      console.error(`[profixio] match ${matchId} refresh failed, serving stale:`, e instanceof Error ? e.message : String(e));
      return withSchedule(usable.payload, scheduleRow, usable.fetched_at);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return err(405, "method_not_allowed");

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) return err(401, "not_authenticated");

  let payload: { action?: unknown; leagueId?: unknown; categoryId?: unknown; matchId?: unknown; refresh?: unknown };
  try {
    payload = await req.json();
  } catch {
    return err(400, "invalid_json");
  }

  const up = newUpstream();
  try {
    switch (payload.action) {
      case "leagues":
        return ok(await leagues(admin, up));
      case "categories":
        return ok(await categories(admin, up, positiveInt(payload.leagueId, "invalid_league")));
      case "schedule": {
        const leagueId = positiveInt(payload.leagueId, "invalid_league");
        const categoryId = positiveInt(payload.categoryId, "invalid_category");
        const { detail } = await ensureLeague(admin, up, leagueId);
        return ok(await ensureSchedule(admin, up, detail, categoryId));
      }
      case "match":
        return ok(
          await match(
            admin,
            up,
            userData.user.id,
            positiveInt(payload.leagueId, "invalid_league"),
            positiveInt(payload.categoryId, "invalid_category"),
            positiveInt(payload.matchId, "invalid_match"),
            payload.refresh === true,
          ),
        );
      default:
        return err(400, "unknown_action");
    }
  } catch (e) {
    if (e instanceof ClientError) return err(e.status, e.token);
    if (e instanceof ParseError) {
      // Profixio changed the API's shape — a distinct token so it groups in Sentry/logs.
      console.error("[profixio] parse failed:", e.message);
      return err(502, "upstream_parse_failed");
    }
    console.error("[profixio] upstream failed:", e instanceof Error ? e.message : String(e));
    return err(502, "upstream_failed");
  }
});
