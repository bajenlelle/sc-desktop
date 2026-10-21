/**
 * Database operations for matches and play-by-play events.
 * All queries run through the browser Supabase client — RLS enforces ownership.
 *
 * Each function accepts a SupabaseClient so this module is isomorphic —
 * desktop, web, and mobile pass their own platform-specific client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUserId } from "./current-user";
import { applyOrgScope, clearLegacyShippedClipsForMatch, type OrgScopeOpts } from "./playlists-db";
import { reportDbError } from "./report";
import type { PlaylistFolder, PlayByPlayEvent, StoredMatch, SyncPoint } from "../types/match";
import { normalizeSyncPoint } from "./period-sync";

// ---------------------------------------------------------------------------
// DB row types (snake_case columns from Postgres)
// ---------------------------------------------------------------------------

interface MatchRow {
  id: string;
  user_id: string;
  title: string;
  game_date: string | null;
  home_team: { name: string; color: string };
  away_team: { name: string; color: string };
  home_roster: Array<{ jerseyNumber: string; playerName: string }>;
  away_roster: Array<{ jerseyNumber: string; playerName: string }>;
  video_url: string | null;
  sync_point: SyncPoint | null;
  league_id: string | null;
  season_id: string | null;
  stage_id: string | null;
  org_id: string | null;
  is_demo?: boolean;
  source_game_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  match_id: string;
  event_id: number | null;
  type: string;
  sub_type: string | null;
  period: number | null;
  game_clock_time: string | null;
  real_world_time: string | null;
  is_successful: number | null;
  player: PlayByPlayEvent["player"];
  event_team: PlayByPlayEvent["eventTeam"];
  qualifiers: string[] | null;
  // Genius-only columns — null on rows imported from the old scrape.
  x?: number | null;
  y?: number | null;
  area?: string | null;
  shot_clock?: string | null;
  previous_action?: number | null;
  on_court_home?: number[] | null;
  on_court_away?: number[] | null;
  score_home?: number | null;
  score_away?: number | null;
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function rowToEvent(e: EventRow): PlayByPlayEvent {
  return {
    eventId: e.event_id ?? 0,
    type: e.type,
    subType: e.sub_type ?? "",
    period: e.period ?? 0,
    gameClockTime: e.game_clock_time ?? "",
    realWorldTime: e.real_world_time ?? "",
    isSuccessful: e.is_successful ?? 0,
    player: e.player ?? null,
    eventTeam: e.event_team ?? null,
    qualifiers: e.qualifiers ?? [],
    x: e.x ?? null,
    y: e.y ?? null,
    area: e.area ?? null,
    shotClock: e.shot_clock ?? null,
    previousAction: e.previous_action ?? null,
    onCourtHome: e.on_court_home ?? null,
    onCourtAway: e.on_court_away ?? null,
    scoreHome: e.score_home ?? null,
    scoreAway: e.score_away ?? null,
  };
}

function rowToStoredMatch(row: MatchRow, events: EventRow[]): StoredMatch {
  return {
    id: row.id,
    title: row.title,
    date: row.game_date ?? "",
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeRoster: row.home_roster,
    awayRoster: row.away_roster,
    videoUrl: row.video_url ?? undefined,
    syncPoint: row.sync_point ? normalizeSyncPoint(row.sync_point) : undefined,
    leagueId: row.league_id ?? undefined,
    seasonId: row.season_id ?? undefined,
    stageId: row.stage_id ?? undefined,
    orgId: row.org_id ?? undefined,
    isDemo: row.is_demo ?? false,
    sourceGameId: row.source_game_id ?? undefined,
    events: events.map(rowToEvent),
  };
}

// ---------------------------------------------------------------------------
// Save (upsert match + bulk-insert events)
// ---------------------------------------------------------------------------

/** Why the database refused a save: the space's import allowance, or the club's expired license. */
export type MatchSaveToken = "import_limit_reached" | "license_locked";

/** The error saveMatch throws, with the gate's token when the database named one. */
export interface MatchSaveError extends Error {
  token?: MatchSaveToken;
}

/** The gate token in a Postgres error message raised by the import triggers, or null. */
export function matchSaveToken(message: string): MatchSaveToken | null {
  if (message.includes("import_limit_reached")) return "import_limit_reached";
  if (message.includes("license_locked")) return "license_locked";
  return null;
}

export async function saveMatch(
  supabase: SupabaseClient,
  match: StoredMatch,
  opts?: {
    /**
     * Overwrite existing event rows instead of keeping them — for re-imports,
     * where the league may have corrected play-by-play data. Same
     * (match_id, event_id) keys, so playlist clips are unaffected.
     */
    refreshEvents?: boolean;
  }
): Promise<void> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Not authenticated");

  const matchData: Record<string, unknown> = {
    id: match.id,
    user_id: user.id,
    title: match.title,
    game_date: match.date || null,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    home_roster: match.homeRoster,
    away_roster: match.awayRoster,
    video_url: match.videoUrl ?? null,
  };
  if (match.syncPoint !== undefined) {
    matchData.sync_point = match.syncPoint;
  }
  if (match.leagueId !== undefined) {
    matchData.league_id = match.leagueId;
  }
  if (match.seasonId !== undefined) {
    matchData.season_id = match.seasonId;
  }
  if (match.stageId !== undefined) {
    matchData.stage_id = match.stageId;
  }
  if (match.orgId !== undefined) {
    matchData.org_id = match.orgId;
  }
  if (match.sourceGameId !== undefined) {
    matchData.source_game_id = match.sourceGameId;
  }
  const { error: matchError } = await supabase.from("matches").upsert(matchData, { onConflict: "id" });
  if (matchError) {
    // The database's gates (the import allowance and the license lock are
    // triggers) arrive as exceptions; the token on the error lets callers
    // branch without matching the message (see import-session.ts).
    const token = matchSaveToken(matchError.message);
    const err: MatchSaveError = new Error(
      token === "license_locked"
        ? "This organization's license has expired — importing is paused until it's renewed."
        : `Failed to save match: ${matchError.message}`,
    );
    if (token) err.token = token;
    throw err;
  }

  try {
    await saveEvents(supabase, match, opts?.refreshEvents ?? false);
  } finally {
    // A re-import may have rewritten the plays: the next read takes them fresh.
    invalidateMatchEvents([match.id]);
  }
}

async function saveEvents(supabase: SupabaseClient, match: StoredMatch, refreshEvents: boolean): Promise<void> {
  if (match.events.length > 0) {
    const eventRows = match.events
      .filter((e) => e.eventId != null)
      .map((e) => ({
        match_id: match.id,
        event_id: e.eventId,
        type: e.type,
        sub_type: e.subType || null,
        period: e.period || null,
        game_clock_time: e.gameClockTime || null,
        real_world_time: e.realWorldTime || null,
        is_successful: e.isSuccessful,
        player: e.player ?? null,
        event_team: e.eventTeam ?? null,
        qualifiers: e.qualifiers.length > 0 ? e.qualifiers : null,
        x: e.x ?? null,
        y: e.y ?? null,
        area: e.area ?? null,
        shot_clock: e.shotClock ?? null,
        previous_action: e.previousAction ?? null,
        on_court_home: e.onCourtHome ?? null,
        on_court_away: e.onCourtAway ?? null,
        score_home: e.scoreHome ?? null,
        score_away: e.scoreAway ?? null,
      }));

    if (eventRows.length > 0) {
      const { error: eventsError } = await supabase
        .from("play_by_play_events")
        .upsert(eventRows, {
          onConflict: "match_id,event_id",
          ignoreDuplicates: !refreshEvents,
        });
      if (eventsError) throw new Error(`Failed to save events: ${eventsError.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection for re-imports
// ---------------------------------------------------------------------------

/**
 * Finds the caller's existing import of a fixture in a given space, by the
 * league API's stable game uuid. Lets the import flow update in place
 * instead of creating an identically-named duplicate. Newest first, so
 * pre-existing legacy duplicates resolve to the most recent copy.
 */
export async function findMatchBySourceGame(
  supabase: SupabaseClient,
  sourceGameId: string,
  orgId?: string
): Promise<{ id: string; title: string; videoUrl?: string; syncPoint?: SyncPoint } | null> {
  const uid = await currentUserId(supabase);
  if (!uid) return null;

  let query = supabase
    .from("matches")
    .select("id, title, video_url, sync_point")
    .eq("user_id", uid)
    .eq("source_game_id", sourceGameId);
  if (orgId) query = query.eq("org_id", orgId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { id: string; title: string; video_url: string | null; sync_point: SyncPoint | null };
  return {
    id: row.id,
    title: row.title,
    videoUrl: row.video_url ?? undefined,
    syncPoint: row.sync_point ? normalizeSyncPoint(row.sync_point) : undefined,
  };
}

/**
 * Which of these games the caller already imported into the space — the
 * picker's "Imported" tags. Same rows findMatchBySourceGame would find. A read
 * error reads as "none imported": the tags are a hint, never a gate.
 */
export async function findImportedSourceGames(
  supabase: SupabaseClient,
  sourceGameIds: string[],
  orgId?: string
): Promise<Set<string>> {
  if (sourceGameIds.length === 0) return new Set();
  const uid = await currentUserId(supabase);
  if (!uid) return new Set();

  let query = supabase
    .from("matches")
    .select("source_game_id")
    .eq("user_id", uid)
    .in("source_game_id", sourceGameIds);
  if (orgId) query = query.eq("org_id", orgId);

  const { data, error } = await query;
  if (error || !data) return new Set();
  return new Set((data as { source_game_id: string | null }[]).map((r) => r.source_game_id).filter((x): x is string => !!x));
}

// ---------------------------------------------------------------------------
// Load a single match with its events
// ---------------------------------------------------------------------------

export async function getMatch(supabase: SupabaseClient, id: string): Promise<StoredMatch | null> {
  const [matchRes, eventsRes] = await Promise.all([
    supabase.from("matches").select("*").eq("id", id).single(),
    supabase
      .from("play_by_play_events")
      .select("*")
      .eq("match_id", id)
      .order("real_world_time", { ascending: true }),
  ]);

  if (matchRes.error || !matchRes.data) return null;

  return rowToStoredMatch(
    matchRes.data as MatchRow,
    (eventsRes.data ?? []) as EventRow[]
  );
}

// ---------------------------------------------------------------------------
// List all matches for the current user
// ---------------------------------------------------------------------------

/**
 * ownOnly matters wherever matches are BROWSED (Library, Home, Clip
 * Browser): RLS also grants read on teammates' matches referenced by shared
 * playlists, and without the filter those render as if they were the
 * user's own. Consumption surfaces (my-playlists) omit it — they need the
 * shared matches for titles and clip metadata.
 */
export async function listMatches(
  supabase: SupabaseClient,
  orgId?: string,
  opts?: { ownOnly?: boolean }
): Promise<StoredMatch[]> {
  let query = supabase
    .from("matches")
    .select("*, play_by_play_events(*)")
    .order("created_at", { ascending: false });
  if (orgId) query = query.eq("org_id", orgId);
  if (opts?.ownOnly) {
    const uid = await currentUserId(supabase);
    if (!uid) return [];
    query = query.eq("user_id", uid);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as (MatchRow & { play_by_play_events: EventRow[] })[]).map((row) =>
    rowToStoredMatch(row, row.play_by_play_events ?? [])
  );
}

// ---------------------------------------------------------------------------
// Fetch events for a specific set of match IDs in a single query
// ---------------------------------------------------------------------------

/**
 * A game's play-by-play is written once, at import (saveMatch), and only
 * replaced by a re-import or removed with the game (deleteMatch), so it is
 * read once per session: every page after the first, and every page open
 * after that, takes it from here. That read is the biggest one the apps
 * make (~225 KB of JSON per game).
 *
 * Keyed by user as well as game: RLS shows a playlist recipient only the
 * plays behind its clips, so one account's full list must never serve
 * another signed in on the same device. A reload empties it, so a
 * server-side correction arrives with the next app start. The arrays are
 * shared between callers: read them, never mutate them.
 */
const eventsCache = new Map<string, PlayByPlayEvent[]>();
const eventsInflight = new Map<string, Promise<PlayByPlayEvent[] | undefined>>();

/** Forgets the cached play-by-play of these games (all games without ids), for every user. */
export function invalidateMatchEvents(matchIds?: readonly string[]): void {
  if (!matchIds) {
    eventsCache.clear();
    return;
  }
  const ids = new Set(matchIds);
  for (const key of [...eventsCache.keys()]) {
    if (ids.has(key.slice(key.indexOf(":") + 1))) eventsCache.delete(key);
  }
}

export async function listEventsForMatches(
  supabase: SupabaseClient,
  matchIds: string[]
): Promise<Record<string, PlayByPlayEvent[]>> {
  if (matchIds.length === 0) return {};
  const uid = await currentUserId(supabase);
  const byMatch: Record<string, PlayByPlayEvent[]> = {};
  const waits: Promise<unknown>[] = [];
  const need: string[] = [];
  for (const id of new Set(matchIds)) {
    const key = `${uid}:${id}`;
    const hit = uid ? eventsCache.get(key) : undefined;
    if (hit) {
      byMatch[id] = hit;
      continue;
    }
    const pending = uid ? eventsInflight.get(key) : undefined;
    if (pending) waits.push(pending.then((events) => { if (events) byMatch[id] = events; }));
    else need.push(id);
  }
  if (need.length > 0) {
    const read = (async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("id, play_by_play_events(*)")
        .in("id", need);
      if (error || !data) return null;
      const fetched: Record<string, PlayByPlayEvent[]> = {};
      for (const row of data as { id: string; play_by_play_events: EventRow[] }[]) {
        fetched[row.id] = (row.play_by_play_events ?? []).map(rowToEvent);
      }
      return fetched;
    })();
    for (const id of need) {
      const key = `${uid}:${id}`;
      const one = read.then((fetched) => fetched?.[id]);
      if (uid) {
        eventsInflight.set(key, one);
        void one.finally(() => {
          if (eventsInflight.get(key) === one) eventsInflight.delete(key);
        });
      }
    }
    waits.push(
      read.then((fetched) => {
        if (!fetched) return;
        for (const [id, events] of Object.entries(fetched)) {
          byMatch[id] = events;
          // A game RLS didn't return isn't cached: the next call asks again.
          if (uid) eventsCache.set(`${uid}:${id}`, events);
        }
      }),
    );
  }
  await Promise.all(waits);
  return byMatch;
}

// ---------------------------------------------------------------------------
// Update sync point only (fast re-calibration)
// ---------------------------------------------------------------------------

export async function updateSyncPoint(
  supabase: SupabaseClient,
  matchId: string,
  syncPoint: SyncPoint | null
): Promise<{ clearedShippedClips: number }> {
  const { error } = await supabase
    .from("matches")
    .update({ sync_point: syncPoint })
    .eq("id", matchId);
  if (error) throw new Error(`Failed to update sync point: ${error.message}`);
  return { clearedShippedClips: await invalidateShippedClips(supabase, matchId) };
}

/**
 * A sync change moves the cut of every clip it reaches. Uploads whose key
 * records where they were cut are compared and re-cut by the desktop in the
 * background (players keep the old file until the new one is up); uploads
 * from before keys carried a start can't be compared, so they stop being
 * served (see clearLegacyShippedClipsForMatch). Best-effort: a failed
 * invalidation must never fail the sync save itself.
 */
async function invalidateShippedClips(
  supabase: SupabaseClient,
  matchId: string,
): Promise<number> {
  try {
    return await clearLegacyShippedClipsForMatch(supabase, matchId);
  } catch (e) {
    reportDbError("clearLegacyShippedClipsForMatch", {
      message: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Update video URL after TUS upload
// ---------------------------------------------------------------------------

export async function updateVideoUrl(
  supabase: SupabaseClient,
  matchId: string,
  videoUrl: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("matches")
    .update({ video_url: videoUrl })
    .eq("id", matchId)
    .select("id");
  if (error) throw new Error(`Failed to update video URL: ${error.message}`);
  // Zero rows means RLS filtered the update away (not this user's match, or a
  // stale id) — without this check a relink LOOKS successful (optimistic UI,
  // working playback) but the DB row never changed, so the missing-video gate
  // comes back on the next probe and even a restart doesn't fix it.
  if (!data || data.length === 0) {
    throw new Error("The video link wasn't saved — this game may belong to another account.");
  }
}

// ---------------------------------------------------------------------------
// Update match metadata (title, date, teams, rosters, sync point)
// ---------------------------------------------------------------------------

export async function updateMatchMeta(
  supabase: SupabaseClient,
  matchId: string,
  updates: {
    title?: string;
    date?: string;
    homeTeam?: { name: string; color: string };
    awayTeam?: { name: string; color: string };
    homeRoster?: Array<{ jerseyNumber: string; playerName: string }>;
    awayRoster?: Array<{ jerseyNumber: string; playerName: string }>;
    syncPoint?: SyncPoint | null;
  }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.date !== undefined) row.game_date = updates.date || null;
  if (updates.homeTeam !== undefined) row.home_team = updates.homeTeam;
  if (updates.awayTeam !== undefined) row.away_team = updates.awayTeam;
  if (updates.homeRoster !== undefined) row.home_roster = updates.homeRoster;
  if (updates.awayRoster !== undefined) row.away_roster = updates.awayRoster;
  if ("syncPoint" in updates) row.sync_point = updates.syncPoint ?? null;
  const { error } = await supabase.from("matches").update(row).eq("id", matchId);
  if (error) throw new Error(`Failed to update match: ${error.message}`);
  // Same invalidation as updateSyncPoint: uploads cut with the old sync must
  // not survive a sync change through this path either.
  if ("syncPoint" in updates) await invalidateShippedClips(supabase, matchId);
}

// ---------------------------------------------------------------------------
// Delete a match and all its events
// ---------------------------------------------------------------------------

export async function deleteMatch(supabase: SupabaseClient, matchId: string): Promise<void> {
  invalidateMatchEvents([matchId]);
  await supabase.from("play_by_play_events").delete().eq("match_id", matchId);
  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) throw new Error(`Failed to delete match: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Playlist folders
// ---------------------------------------------------------------------------

interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  parent_id: string | null;
  org_id: string | null;
  created_at: string;
}

function rowToFolder(row: FolderRow): PlaylistFolder {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    parentId: row.parent_id ?? undefined,
    orgId: row.org_id ?? undefined,
  };
}

export async function listFolders(
  supabase: SupabaseClient,
  orgId?: string,
  opts?: OrgScopeOpts,
): Promise<PlaylistFolder[]> {
  let query = supabase
    .from("playlist_folders")
    .select("*");
  query = applyOrgScope(query, orgId, opts);
  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error || !data) return [];
  return (data as FolderRow[]).map(rowToFolder);
}

export async function createFolder(
  supabase: SupabaseClient,
  name: string,
  parentId?: string,
  orgId?: string,
): Promise<PlaylistFolder> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("playlist_folders")
    .insert({ user_id: user.id, name, sort_order: 0, parent_id: parentId ?? null, org_id: orgId ?? null })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to create folder: ${error?.message}`);
  return rowToFolder(data as FolderRow);
}

export async function updateFolder(
  supabase: SupabaseClient,
  id: string,
  patch: { name?: string; sortOrder?: number; parentId?: string | null }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  // "key in patch" so an explicit null re-parents to root, omission leaves unchanged.
  if ("parentId" in patch) row.parent_id = patch.parentId ?? null;
  const { error } = await supabase.from("playlist_folders").update(row).eq("id", id);
  if (error) throw new Error(`Failed to update folder: ${error.message}`);
}

export async function deleteFolder(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("playlist_folders").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete folder: ${error.message}`);
}

// ---------------------------------------------------------------------------
// List all matches WITHOUT loading events (fast — for match title resolution)
// ---------------------------------------------------------------------------

export async function listMatchesLight(
  supabase: SupabaseClient,
  orgId?: string,
  /** withEventCount fills eventCount (a count per game, not the plays). */
  opts?: { ownOnly?: boolean; includeUnscoped?: boolean; withEventCount?: boolean }
): Promise<StoredMatch[]> {
  let query = supabase
    .from("matches")
    .select(opts?.withEventCount ? "*, play_by_play_events(count)" : "*")
    .order("created_at", { ascending: false });
  // Same scoping contract as listPlaylists/listFolders (applyOrgScope):
  // includeUnscoped admits legacy org_id-NULL rows. Callers that pass it for
  // playlists MUST pass it here too, or those playlists reference matches
  // the page can't see and their clips silently vanish.
  if (orgId) {
    query = opts?.includeUnscoped
      ? query.or(`org_id.eq.${orgId},org_id.is.null`)
      : query.eq("org_id", orgId);
  }
  if (opts?.ownOnly) {
    const uid = await currentUserId(supabase);
    if (!uid) return [];
    query = query.eq("user_id", uid);
  }
  const { data, error } = await query;
  // Graceful degrade, but never silently: an empty result from a FAILED query
  // looks identical to an empty library to callers (the playlists page keeps
  // stale match state, gates flip to wrong reasons), so make it visible.
  if (error) reportDbError("listMatchesLight", error);
  if (error || !data) return [];
  return (data as unknown as (MatchRow & { play_by_play_events?: { count: number }[] })[]).map((row) => {
    const match = rowToStoredMatch(row, []);
    if (opts?.withEventCount) match.eventCount = row.play_by_play_events?.[0]?.count ?? 0;
    return match;
  });
}

export async function countMatchesThisMonth(supabase: SupabaseClient): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await supabase
    .from("matches")
    .select("*", { count: "exact", head: true })
    .gte("created_at", startOfMonth)
    .eq("is_demo", false);
  return count ?? 0;
}

/**
 * Copy the sample game into the caller's personal org so a brand-new user
 * can try clips → playlists with zero footage. Server-side idempotent (once
 * per user, ever); returns the new match id, or null when it no-ops
 * (already seeded, org not personal, or no template configured yet).
 */
export async function seedDemoMatch(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("seed_demo_match", { p_org_id: orgId });
  if (error) throw new Error(`Failed to seed demo match: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function countClubMatchesThisMonth(
  supabase: SupabaseClient,
  ntLeagueIds: string[],
  orgId?: string
): Promise<number> {
  const { data } = await supabase.rpc("count_club_matches_this_month", {
    p_nt_league_ids: ntLeagueIds,
    ...(orgId ? { p_org_id: orgId } : {}),
  });
  return (data as number) ?? 0;
}
