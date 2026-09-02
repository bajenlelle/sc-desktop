// Scoutable — Genius Sports proxy Edge Function
// Called from the desktop importer via supabase.functions.invoke (JWT verified
// by the platform since verify_jwt defaults to true). The only place the
// GENIUS_API_KEY exists: Genius requires all Warehouse calls to go through a
// backend with caching (20k calls/month quota), so every response is cached in
// genius_fixture_cache / genius_match_cache and repeat requests cost nothing
// upstream. Two actions:
//   { action: "fixtures", competitionId }          → fixture list, 6h TTL
//   { action: "match", competitionId, matchId }    → actions + players, cached
//                                                    forever (COMPLETE matches
//                                                    are immutable upstream)

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GENIUS_API_KEY = Deno.env.get("GENIUS_API_KEY") ?? "";

const GENIUS_BASE = "https://api.wh.geniussports.com/v1/basketball";
const FIXTURES_TTL_MS = 6 * 60 * 60 * 1000;
const PAGE_LIMIT = 500; // Warehouse max per page

// Competitions the function will fetch — mirrors LEAGUES in
// apps/desktop/src/lib/basketball-api.ts. A Genius competition IS a
// league-season, so next season is one id added here + one in LEAGUES.
const COMPETITIONS = new Set<number>([
  41539, // SBL Herr 2025-26
  42013, // SBL Dam 2025-26
  42132, // Superettan Herr 2025-26
  42251, // Basketettan Herr 2025-26
  42250, // Basketettan Dam 2025-26
]);

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

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

/** One Warehouse GET, unwrapped to the data array/object. Throws on failure. */
async function genius(path: string): Promise<Json[] | Json> {
  const res = await fetch(`${GENIUS_BASE}${path}`, {
    headers: { "x-api-key": GENIUS_API_KEY, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`genius ${path} → ${res.status}`);
  const body = await res.json();
  return body?.response?.data ?? [];
}

/** Paginate a Warehouse list endpoint until a short page. */
async function geniusAll(path: string): Promise<Json[]> {
  const all: Json[] = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const sep = path.includes("?") ? "&" : "?";
    const page = (await genius(`${path}${sep}limit=${PAGE_LIMIT}&offset=${offset}`)) as Json[];
    all.push(...page);
    if (page.length < PAGE_LIMIT) return all;
  }
}

/** Raw fixture → the trimmed shape clients receive (~10× smaller). */
function trimFixture(m: Json): Json {
  return {
    matchId: m.matchId,
    matchTimeUTC: m.matchTimeUTC ?? "",
    matchStatus: m.matchStatus ?? "",
    matchType: m.matchType ?? "",
    statsSource: m.statsSource ?? "",
    venueName: m.venue?.venueName ?? "",
    competitors: (m.competitors ?? []).map((c: Json) => ({
      teamId: c.teamId,
      teamName: c.teamName ?? "",
      scoreString: c.scoreString ?? "",
      isHomeCompetitor: c.isHomeCompetitor ?? 0,
      logoUrl: c.images?.logo?.S1?.url ?? "",
    })),
  };
}

/** Raw action → only the fields the app reads (halves the payload). */
function trimAction(a: Json): Json {
  return {
    actionNumber: a.actionNumber,
    actionType: a.actionType ?? "",
    subType: a.subType ?? "",
    period: a.period ?? 0,
    periodType: a.periodType ?? "",
    clock: a.clock ?? "",
    shotClock: a.shotClock ?? "",
    timeActual: a.timeActual ?? "",
    success: a.success ?? 0,
    personId: a.personId ?? 0,
    shirtNumber: a.shirtNumber ?? "",
    firstName: a.firstName ?? "",
    familyName: a.familyName ?? "",
    teamId: a.teamId ?? 0,
    teamName: a.teamName ?? "",
    qualifiers: a.qualifiers ?? "",
    previousAction: a.previousAction ?? 0,
    x: a.x ?? 0,
    y: a.y ?? 0,
    area: a.area ?? "",
    playersTeam1: a.playersTeam1 ?? "",
    playersTeam2: a.playersTeam2 ?? "",
    score1: a.score1 ?? "",
    score2: a.score2 ?? "",
  };
}

function trimPlayer(p: Json): Json {
  return {
    personId: p.personId,
    firstName: p.firstName ?? "",
    familyName: p.familyName ?? "",
    shirtNumber: p.shirtNumber ?? "",
    teamId: p.teamId ?? 0,
    isPlayer: p.isPlayer ?? 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return err(405, "method_not_allowed");

  // Fail closed: without the key we must refuse rather than proxy nothing.
  if (!GENIUS_API_KEY) {
    console.error("[genius] GENIUS_API_KEY is not configured — refusing all requests");
    return err(500, "server_misconfigured");
  }

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) return err(401, "not_authenticated");

  let payload: { action?: string; competitionId?: number; matchId?: number };
  try {
    payload = await req.json();
  } catch {
    return err(400, "invalid_json");
  }

  const competitionId = Number(payload.competitionId);
  if (!COMPETITIONS.has(competitionId)) return err(400, "unknown_competition");

  try {
    if (payload.action === "fixtures") {
      const { data: cached } = await admin
        .from("genius_fixture_cache")
        .select("payload, fetched_at")
        .eq("competition_id", competitionId)
        .maybeSingle();

      let fixtures = cached?.payload as Json[] | undefined;
      const stale =
        !cached || Date.now() - new Date(cached.fetched_at).getTime() > FIXTURES_TTL_MS;

      if (stale) {
        try {
          fixtures = await geniusAll(`/competitions/${competitionId}/matches`);
          const { error: upsertError } = await admin
            .from("genius_fixture_cache")
            .upsert(
              { competition_id: competitionId, payload: fixtures, fetched_at: new Date().toISOString() },
              { onConflict: "competition_id" },
            );
          if (upsertError) console.error("[genius] fixture cache upsert failed:", upsertError.message);
        } catch (e) {
          // Serve stale data over an error when we have it.
          if (!fixtures) throw e;
          console.error("[genius] fixture refresh failed, serving stale:", e instanceof Error ? e.message : String(e));
        }
      }

      return ok({ fixtures: (fixtures ?? []).map(trimFixture) });
    }

    if (payload.action === "match") {
      const matchId = Number(payload.matchId);
      if (!Number.isFinite(matchId) || matchId <= 0) return err(400, "invalid_match");

      // The fixture row doubles as the existence/authorization check: only
      // matches of allowlisted competitions can ever be fetched.
      const { data: fixtureCache } = await admin
        .from("genius_fixture_cache")
        .select("payload")
        .eq("competition_id", competitionId)
        .maybeSingle();
      const fixtureRaw = ((fixtureCache?.payload as Json[]) ?? []).find(
        (m) => m.matchId === matchId,
      );
      if (!fixtureRaw) return err(404, "match_not_available");

      const { data: cached } = await admin
        .from("genius_match_cache")
        .select("actions, players, pbp_status")
        .eq("genius_match_id", matchId)
        .maybeSingle();

      if (cached) {
        return ok({
          fixture: trimFixture(fixtureRaw),
          actions: cached.actions,
          players: cached.players,
          pbpStatus: cached.pbp_status,
        });
      }

      const [actions, players] = await Promise.all([
        geniusAll(`/matches/${matchId}/actions`),
        geniusAll(`/matches/${matchId}/players`),
      ]);
      const trimmedActions = actions.map(trimAction);
      const trimmedPlayers = players.map(trimPlayer);
      // 'empty' is a negative cache — a permanently PBP-less match (empty
      // statsSource upstream) must not cost quota on every retry.
      const pbpStatus = trimmedActions.length > 0 ? "ok" : "empty";

      // Concurrent imports of the same match may both reach here; the upsert
      // makes the double-fetch harmless (last write wins, identical data).
      const { error: upsertError } = await admin.from("genius_match_cache").upsert(
        {
          genius_match_id: matchId,
          competition_id: competitionId,
          actions: trimmedActions,
          players: trimmedPlayers,
          pbp_status: pbpStatus,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "genius_match_id" },
      );
      if (upsertError) console.error("[genius] match cache upsert failed:", upsertError.message);

      return ok({
        fixture: trimFixture(fixtureRaw),
        actions: trimmedActions,
        players: trimmedPlayers,
        pbpStatus,
      });
    }

    return err(400, "unknown_action");
  } catch (e) {
    console.error("[genius] upstream failed:", e instanceof Error ? e.message : String(e));
    return err(502, "upstream_failed");
  }
});
