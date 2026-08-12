/**
 * Database operations for matches and play-by-play events.
 * All queries run through the browser Supabase client — RLS enforces ownership.
 *
 * Each function accepts a SupabaseClient so this module is isomorphic —
 * desktop, web, and mobile pass their own platform-specific client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaylistFolder, PlayByPlayEvent, StoredMatch, SyncPoint } from "../types/match";

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
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

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
    syncPoint: row.sync_point ?? undefined,
    leagueId: row.league_id ?? undefined,
    seasonId: row.season_id ?? undefined,
    stageId: row.stage_id ?? undefined,
    orgId: row.org_id ?? undefined,
    isDemo: row.is_demo ?? false,
    sourceGameId: row.source_game_id ?? undefined,
    events: events.map((e) => ({
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
    })),
  };
}

// ---------------------------------------------------------------------------
// Save (upsert match + bulk-insert events)
// ---------------------------------------------------------------------------

export async function saveMatch(supabase: SupabaseClient, match: StoredMatch): Promise<void> {
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
  if (matchError) throw new Error(`Failed to save match: ${matchError.message}`);

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
      }));

    if (eventRows.length > 0) {
      const { error: eventsError } = await supabase
        .from("play_by_play_events")
        .upsert(eventRows, { onConflict: "match_id,event_id", ignoreDuplicates: true });
      if (eventsError) throw new Error(`Failed to save events: ${eventsError.message}`);
    }
  }
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    query = query.eq("user_id", user.id);
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

export async function listEventsForMatches(
  supabase: SupabaseClient,
  matchIds: string[]
): Promise<Record<string, PlayByPlayEvent[]>> {
  if (matchIds.length === 0) return {};
  const { data, error } = await supabase
    .from("matches")
    .select("id, play_by_play_events(*)")
    .in("id", matchIds);
  if (error || !data) return {};
  const byMatch: Record<string, PlayByPlayEvent[]> = {};
  for (const row of data as { id: string; play_by_play_events: EventRow[] }[]) {
    byMatch[row.id] = (row.play_by_play_events ?? []).map((e) => ({
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
    }));
  }
  return byMatch;
}

// ---------------------------------------------------------------------------
// Update sync point only (fast re-calibration)
// ---------------------------------------------------------------------------

export async function updateSyncPoint(
  supabase: SupabaseClient,
  matchId: string,
  syncPoint: SyncPoint | null
): Promise<void> {
  const { error } = await supabase
    .from("matches")
    .update({ sync_point: syncPoint })
    .eq("id", matchId);
  if (error) throw new Error(`Failed to update sync point: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Update video URL after TUS upload
// ---------------------------------------------------------------------------

export async function updateVideoUrl(
  supabase: SupabaseClient,
  matchId: string,
  videoUrl: string,
): Promise<void> {
  const { error } = await supabase
    .from("matches")
    .update({ video_url: videoUrl })
    .eq("id", matchId);
  if (error) throw new Error(`Failed to update video URL: ${error.message}`);
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
}

// ---------------------------------------------------------------------------
// Delete a match and all its events
// ---------------------------------------------------------------------------

export async function deleteMatch(supabase: SupabaseClient, matchId: string): Promise<void> {
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
  created_at: string;
}

function rowToFolder(row: FolderRow): PlaylistFolder {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}

export async function listFolders(supabase: SupabaseClient): Promise<PlaylistFolder[]> {
  const { data, error } = await supabase
    .from("playlist_folders")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  return (data as FolderRow[]).map(rowToFolder);
}

export async function createFolder(supabase: SupabaseClient, name: string): Promise<PlaylistFolder> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("playlist_folders")
    .insert({ user_id: user.id, name, sort_order: 0 })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to create folder: ${error?.message}`);
  return rowToFolder(data as FolderRow);
}

export async function updateFolder(
  supabase: SupabaseClient,
  id: string,
  patch: { name?: string; sortOrder?: number }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
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
  opts?: { ownOnly?: boolean }
): Promise<StoredMatch[]> {
  let query = supabase
    .from("matches")
    .select("*")
    .order("created_at", { ascending: false });
  if (orgId) query = query.eq("org_id", orgId);
  if (opts?.ownOnly) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    query = query.eq("user_id", user.id);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as MatchRow[]).map((row) => rowToStoredMatch(row, []));
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
