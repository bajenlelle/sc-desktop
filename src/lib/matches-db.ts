/**
 * Database operations for matches and play-by-play events.
 * All queries run through the browser Supabase client — RLS enforces ownership.
 */

import { createClient } from "@/lib/supabase/client";
import type { PlaylistFolder, PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

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

export async function saveMatch(match: StoredMatch): Promise<void> {
  const supabase = createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Not authenticated");

  // Upsert the match row
  const { error: matchError } = await supabase.from("matches").upsert(
    {
      id: match.id,
      user_id: user.id,
      title: match.title,
      game_date: match.date || null,
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      home_roster: match.homeRoster,
      away_roster: match.awayRoster,
      video_url: match.videoUrl ?? null,
      sync_point: match.syncPoint ?? null,
    },
    { onConflict: "id" }
  );
  if (matchError) throw new Error(`Failed to save match: ${matchError.message}`);

  // Bulk-insert events, skipping any that are already stored
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

export async function getMatch(id: string): Promise<StoredMatch | null> {
  const supabase = createClient();

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

export async function listMatches(): Promise<StoredMatch[]> {
  const supabase = createClient();

  const [matchesRes, eventsRes] = await Promise.all([
    supabase.from("matches").select("*").order("created_at", { ascending: false }),
    supabase.from("play_by_play_events").select("*").order("real_world_time", { ascending: true }),
  ]);

  if (matchesRes.error || !matchesRes.data) return [];

  const eventsByMatch: Record<string, EventRow[]> = {};
  for (const e of (eventsRes.data ?? []) as EventRow[]) {
    if (!eventsByMatch[e.match_id]) eventsByMatch[e.match_id] = [];
    eventsByMatch[e.match_id].push(e);
  }

  return (matchesRes.data as MatchRow[]).map((row) =>
    rowToStoredMatch(row, eventsByMatch[row.id] ?? [])
  );
}

// ---------------------------------------------------------------------------
// Fetch events for a specific set of match IDs in a single query
// Returns a map of matchId → events (sorted by real_world_time)
// ---------------------------------------------------------------------------

export async function listEventsForMatches(
  matchIds: string[]
): Promise<Record<string, PlayByPlayEvent[]>> {
  if (matchIds.length === 0) return {};
  const supabase = createClient();
  const { data, error } = await supabase
    .from("play_by_play_events")
    .select("*")
    .in("match_id", matchIds)
    .order("real_world_time", { ascending: true });
  if (error || !data) return {};
  const byMatch: Record<string, PlayByPlayEvent[]> = {};
  for (const row of data as EventRow[]) {
    const key = row.match_id;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push({
      eventId: row.event_id ?? 0,
      type: row.type,
      subType: row.sub_type ?? "",
      period: row.period ?? 0,
      gameClockTime: row.game_clock_time ?? "",
      realWorldTime: row.real_world_time ?? "",
      isSuccessful: row.is_successful ?? 0,
      player: row.player ?? null,
      eventTeam: row.event_team ?? null,
      qualifiers: row.qualifiers ?? [],
    });
  }
  return byMatch;
}

// ---------------------------------------------------------------------------
// Update sync point only (fast re-calibration)
// ---------------------------------------------------------------------------

export async function updateSyncPoint(
  matchId: string,
  syncPoint: SyncPoint | null
): Promise<void> {
  const supabase = createClient();
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
  matchId: string,
  videoUrl: string,
): Promise<void> {
  const supabase = createClient();
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
  const supabase = createClient();
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

export async function deleteMatch(matchId: string): Promise<void> {
  const supabase = createClient();
  // Delete child rows first (guards against missing CASCADE)
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

export async function listFolders(): Promise<PlaylistFolder[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("playlist_folders")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  return (data as FolderRow[]).map(rowToFolder);
}

export async function createFolder(name: string): Promise<PlaylistFolder> {
  const supabase = createClient();
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
  id: string,
  patch: { name?: string; sortOrder?: number }
): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { error } = await supabase.from("playlist_folders").update(row).eq("id", id);
  if (error) throw new Error(`Failed to update folder: ${error.message}`);
}

export async function deleteFolder(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("playlist_folders").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete folder: ${error.message}`);
}

// ---------------------------------------------------------------------------
// List all matches WITHOUT loading events (fast — for match title resolution)
// ---------------------------------------------------------------------------

export async function listMatchesLight(): Promise<StoredMatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as MatchRow[]).map((row) => rowToStoredMatch(row, []));
}
