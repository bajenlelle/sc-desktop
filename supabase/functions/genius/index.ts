// Scoutable — Genius Sports proxy Edge Function
// Called from the desktop importer via supabase.functions.invoke (JWT verified
// by the platform since verify_jwt defaults to true). The only place the
// GENIUS_API_KEY exists: Genius requires all Warehouse calls to go through a
// backend with caching (20k calls/month quota), so every response is cached in
// genius_fixture_cache / genius_match_cache and repeat requests cost nothing
// upstream. Three actions:
//   { action: "fixtures", competitionId }          → fixture list, 6h TTL
//   { action: "match", competitionId, matchId }    → actions + players, cached
//                                                    forever (COMPLETE matches
//                                                    are immutable upstream)
//   { action: "competitions" }                     → raw competition list,
//                                                    platform-admin only; the
//                                                    once-a-season maintenance
//                                                    tool for finding the new
//                                                    season's competition ids
//   { action: "sync_teams" }                       → rebuild the league team
//                                                    catalogue from every
//                                                    catalogued season,
//                                                    platform-admin only

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GENIUS_API_KEY = Deno.env.get("GENIUS_API_KEY") ?? "";
// Weekly season audit (cron-only, shared-secret auth — see runSeasonAudit).
const AUDIT_SECRET = Deno.env.get("SEASON_AUDIT_SECRET") ?? "";
const GITHUB_ISSUES_TOKEN = Deno.env.get("GITHUB_ISSUES_TOKEN") ?? "";
const GITHUB_REPO = Deno.env.get("GITHUB_ISSUES_REPO") ?? "bajenlelle/sc-desktop";

const GENIUS_BASE = "https://api.wh.geniussports.com/v1/basketball";
const FIXTURES_TTL_MS = 6 * 60 * 60 * 1000;
const PAGE_LIMIT = 500; // Warehouse max per page

// The league catalogue, and the single source of what this function will
// fetch. Clients read it through the `leagues` action instead of bundling
// their own copy, so adding next season is one record here plus a deploy —
// no desktop release, and no window where a client offers a season the
// allowlist rejects.
//
// SBF publishes the new competitions at different times (the 2026/27
// Basketettan ids only appeared weeks after the SBL and Superettan ones), so
// a league stuck on an old season here usually means upstream hasn't created
// it yet. Find new ids with the platform-admin `competitions` action.
type CatalogSeason = { id: string; label: string; competitionId: number };
type CatalogLeague = {
  id: string;
  name: string;
  country: string;
  gender: "men" | "women";
  /** Newest first — seasons[0] is the current season. */
  seasons: CatalogSeason[];
};

const CATALOG: CatalogLeague[] = [
  {
    id: "sbl-herr",
    name: "SBL Herr",
    country: "SE",
    gender: "men",
    seasons: [
      { id: "2026-27", label: "2026/27", competitionId: 48974 },
      { id: "2025-26", label: "2025/26", competitionId: 41539 },
    ],
  },
  {
    id: "sbl-dam",
    name: "SBL Dam",
    country: "SE",
    gender: "women",
    seasons: [
      { id: "2026-27", label: "2026/27", competitionId: 49288 },
      { id: "2025-26", label: "2025/26", competitionId: 42013 },
    ],
  },
  {
    id: "superettan-herr",
    name: "Superettan Herr",
    country: "SE",
    gender: "men",
    seasons: [
      { id: "2026-27", label: "2026/27", competitionId: 49176 },
      { id: "2025-26", label: "2025/26", competitionId: 42132 },
    ],
  },
  {
    id: "basketettan-herr",
    name: "Basketettan Herr",
    country: "SE",
    gender: "men",
    seasons: [
      { id: "2026-27", label: "2026/27", competitionId: 50039 },
      { id: "2025-26", label: "2025/26", competitionId: 42251 },
    ],
  },
  {
    id: "basketettan-dam",
    name: "Basketettan Dam",
    country: "SE",
    gender: "women",
    seasons: [
      { id: "2026-27", label: "2026/27", competitionId: 50038 },
      { id: "2025-26", label: "2025/26", competitionId: 42250 },
    ],
  },
];

// Derived, never hand-maintained: the two can't drift apart.
const COMPETITIONS = new Set<number>(
  CATALOG.flatMap((l) => l.seasons.map((s) => s.competitionId)),
);

/** Actions that address no single competition, so they skip the id guard. */
const COMPETITION_FREE_ACTIONS = new Set(["competitions", "leagues", "sync_teams"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey, x-audit-secret",
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

// ---------------------------------------------------------------------------
// Weekly season audit
//
// Rolling a league to the next season is manual, and SBF publishes the new
// competitions at unpredictable times — Basketettan 2026/27 appeared weeks
// after the SBL and Superettan ones. Until someone noticed, that league simply
// showed no games. This turns "nobody looked" into a GitHub issue.
// ---------------------------------------------------------------------------

/**
 * Strip the gendered prefix SBF puts on competition names and normalise the
 * rest, so the same league matches across seasons.
 */
function normaliseCompetitionName(name: string): string {
  return name
    .replace(/^\s*(herrar|damer)\s*-\s*/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * File one issue for the findings, or none if an unresolved one is already
 * open. Without the dedupe this would open a fresh issue every Monday until
 * someone got round to it.
 */
async function fileAuditIssue(findings: string[]): Promise<string> {
  if (!GITHUB_ISSUES_TOKEN) return "skipped_no_token";

  const gh = (path: string, init?: RequestInit) =>
    fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${GITHUB_ISSUES_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
    });

  const openRes = await gh(
    `/repos/${GITHUB_REPO}/issues?state=open&labels=season-audit&per_page=1`,
  );
  if (openRes.ok) {
    const open = await openRes.json();
    if (Array.isArray(open) && open.length > 0) return `deduped_#${open[0].number}`;
  }

  const body = [
    "The weekly league-catalogue audit found something that needs a human.",
    "",
    ...findings,
    "",
    "---",
    "Fix by editing `CATALOG` in `supabase/functions/genius/index.ts` and deploying",
    "the function (`npx supabase functions deploy genius`). Clients read the",
    "catalogue from there, so no desktop release is needed.",
    "",
    "Find new competition ids with the platform-admin `competitions` action.",
  ].join("\n");

  const res = await gh(`/repos/${GITHUB_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: "League catalogue is out of date",
      body,
      labels: ["bug", "season-audit"],
    }),
  });
  if (!res.ok) {
    console.error("[genius] audit issue failed:", res.status, await res.text());
    return `file_failed_${res.status}`;
  }
  return `filed_#${(await res.json()).number}`;
}

/** Compare the catalogue against upstream; file an issue if it has drifted. */
async function runSeasonAudit(): Promise<Json> {
  const upstream = (await geniusAll("/competitions")) as Json[];
  const byId = new Map<number, Json>();
  for (const c of upstream) {
    const id = Number(c.competitionId);
    if (Number.isFinite(id)) byId.set(id, c);
  }

  const findings: string[] = [];

  for (const league of CATALOG) {
    const current = league.seasons[0];

    // Anchor on what upstream calls an id we already hold, never on our own
    // display name: SBF renamed this same league between seasons
    // ("Basketettan Herr" → "Herrar - Basketettan Herr"), so matching on our
    // name would quietly stop finding it — the exact miss this audit exists
    // to catch.
    const anchor = byId.get(current.competitionId);
    if (!anchor) {
      findings.push(
        `- **${league.name}**: configured competition \`${current.competitionId}\` ` +
          `(${current.label}) is not in the upstream competition list at all.`,
      );
      continue;
    }

    const key = normaliseCompetitionName(String(anchor.competitionName ?? ""));
    const configured = new Set(league.seasons.map((s) => s.competitionId));
    for (const c of upstream) {
      const id = Number(c.competitionId);
      if (configured.has(id)) continue;
      if (normaliseCompetitionName(String(c.competitionName ?? "")) !== key) continue;
      // Season strings are "2026-2027", so they order lexicographically.
      if (String(c.season ?? "") <= String(anchor.season ?? "")) continue;
      findings.push(
        `- **${league.name}**: upstream has season \`${c.season}\` as competition ` +
          `\`${id}\`, which we don't carry. Newest configured is ${current.label} ` +
          `(\`${current.competitionId}\`).`,
      );
    }

    // An empty current season means a wrong id, or upstream pulled the data.
    const fixtures = (await geniusAll(
      `/competitions/${current.competitionId}/matches`,
    )) as Json[];
    if (fixtures.length === 0) {
      findings.push(
        `- **${league.name}** ${current.label}: competition ` +
          `\`${current.competitionId}\` returns no fixtures.`,
      );
    }
  }

  if (findings.length === 0) return { status: "ok", findings: [] };
  return { status: "findings", findings, issue: await fileAuditIssue(findings) };
}

// ---------------------------------------------------------------------------
// Fixtures and the league team catalogue
//
// league_teams is the list users pick "their team" from. It is built from the
// competitors of every catalogued league-season. Genius hands a team a new id
// each season; sync_league_teams links them to one stable team through the
// club id. It runs after every fresh fixture fetch, in the weekly audit, and
// through the platform-admin `sync_teams` action (the one-off backfill).

/** A competition's fixtures from the cache, refreshed from upstream when older than the TTL. */
async function loadFixtures(
  admin: SupabaseClient,
  competitionId: number,
): Promise<{ fixtures: Json[]; fresh: boolean }> {
  const { data: cached } = await admin
    .from("genius_fixture_cache")
    .select("payload, fetched_at")
    .eq("competition_id", competitionId)
    .maybeSingle();

  const stale = !cached || Date.now() - new Date(cached.fetched_at).getTime() > FIXTURES_TTL_MS;
  if (!stale) return { fixtures: (cached.payload as Json[]) ?? [], fresh: false };

  try {
    const fixtures = await geniusAll(`/competitions/${competitionId}/matches`);
    const { error: upsertError } = await admin
      .from("genius_fixture_cache")
      .upsert(
        { competition_id: competitionId, payload: fixtures, fetched_at: new Date().toISOString() },
        { onConflict: "competition_id" },
      );
    if (upsertError) console.error("[genius] fixture cache upsert failed:", upsertError.message);
    return { fixtures, fresh: true };
  } catch (e) {
    // Serve stale data over an error when we have it.
    if (!cached) throw e;
    console.error("[genius] fixture refresh failed, serving stale:", e instanceof Error ? e.message : String(e));
    return { fixtures: (cached.payload as Json[]) ?? [], fresh: false };
  }
}

/** Each competitor once, in the shape sync_league_teams takes. */
function competitorsOf(fixtures: Json[]): Json[] {
  const byId = new Map<string, Json>();
  for (const m of fixtures) {
    for (const c of m.competitors ?? []) {
      const id = c.teamId != null ? String(c.teamId) : "";
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        name: c.teamName ?? "",
        clubId: c.clubId != null ? String(c.clubId) : null,
        clubName: c.clubName ?? null,
        logoUrl: c.images?.logo?.S1?.url ?? null,
      });
    }
  }
  return [...byId.values()];
}

/** Upsert one league-season's teams. Returns how many were written. */
async function syncTeams(admin: SupabaseClient, competitionId: number, fixtures: Json[]): Promise<number> {
  const league = CATALOG.find((l) => l.seasons.some((s) => s.competitionId === competitionId));
  const season = league?.seasons.find((s) => s.competitionId === competitionId);
  if (!league || !season) return 0;
  const teams = competitorsOf(fixtures);
  if (teams.length === 0) return 0;
  const { data, error } = await admin.rpc("sync_league_teams", {
    p_source: "genius",
    p_league_id: league.id,
    p_league_name: league.name,
    p_season_id: season.id,
    p_gender: league.gender,
    p_teams: teams,
  });
  if (error) throw new Error(`sync_league_teams failed: ${error.message}`);
  return Number(data ?? 0);
}

/** Every catalogued season, oldest first, so a team's ids link forward in time. */
async function syncAllTeams(admin: SupabaseClient): Promise<Json> {
  const order = CATALOG.flatMap((league) => league.seasons.map((season) => ({ league, season })))
    .sort((a, b) => a.season.id.localeCompare(b.season.id));
  const synced: Json[] = [];
  for (const { league, season } of order) {
    const { fixtures } = await loadFixtures(admin, season.competitionId);
    synced.push({ league: league.id, season: season.id, teams: await syncTeams(admin, season.competitionId, fixtures) });
  }
  return { synced };
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

  // Cron carries a shared secret, not a user session — pg_cron has no JWT to
  // offer. Handled before the auth check below, which it could never pass.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const auditSecret = req.headers.get("x-audit-secret");
  if (auditSecret !== null) {
    if (!AUDIT_SECRET || auditSecret !== AUDIT_SECRET) return err(401, "bad_audit_secret");
    let audit: Json;
    try {
      audit = await runSeasonAudit();
    } catch (e) {
      console.error("[genius] season audit failed:", e instanceof Error ? e.message : String(e));
      return err(502, "upstream_failed");
    }
    // Same weekly run keeps the team catalogue current, so a new season's
    // teams appear before anyone imports from it. Its failure never hides the audit.
    let teams: Json;
    try {
      teams = await syncAllTeams(admin);
    } catch (e) {
      console.error("[genius] team sync failed:", e instanceof Error ? e.message : String(e));
      teams = { error: "team_sync_failed" };
    }
    return ok({ ...audit, teams });
  }

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) return err(401, "not_authenticated");

  let payload: { action?: string; competitionId?: number; matchId?: number };
  try {
    payload = await req.json();
  } catch {
    return err(400, "invalid_json");
  }

  const competitionId = Number(payload.competitionId);
  if (!COMPETITION_FREE_ACTIONS.has(payload.action ?? "") && !COMPETITIONS.has(competitionId)) {
    return err(400, "unknown_competition");
  }

  try {
    // Annual maintenance: list every competition the key can see, to find the
    // new season's ids (a Genius competition IS a league-season). Raw objects
    // on purpose — this is a discovery tool, trimming would hide the fields
    // you're looking for. Admin-gated: it always costs upstream quota.
    if (payload.action === "competitions" || payload.action === "sync_teams") {
      const { data: prof } = await admin
        .from("profiles")
        .select("is_platform_admin")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (!prof?.is_platform_admin) return err(403, "not_platform_admin");
      if (payload.action === "sync_teams") return ok(await syncAllTeams(admin));
      const competitions = await geniusAll("/competitions");
      return ok({ competitions });
    }

    // The catalogue clients render their picker from. Cheap and static: no
    // upstream call, so it costs no Genius quota and can't fail because the
    // Warehouse is down.
    if (payload.action === "leagues") {
      return ok({ leagues: CATALOG });
    }

    if (payload.action === "fixtures") {
      const { fixtures, fresh } = await loadFixtures(admin, competitionId);
      if (fresh) {
        try {
          await syncTeams(admin, competitionId, fixtures);
        } catch (e) {
          console.error("[genius] team sync failed:", e instanceof Error ? e.message : String(e));
        }
      }
      return ok({ fixtures: fixtures.map(trimFixture) });
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
