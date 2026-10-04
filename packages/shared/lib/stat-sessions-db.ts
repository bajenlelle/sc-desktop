/**
 * Supabase access for stat sessions (the phone writes, the desktop reads).
 * Same conventions as matches-db: the client is the first argument, rows
 * are mapped explicitly, and malformed rows are dropped rather than passed
 * on half-formed. RLS does the gating (see migration 20261004200000).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RosterEntry,
  StatEvent,
  StatEventKind,
  StatEventPrivate,
  StatEventSource,
  StatSession,
  StatSessionStatus,
  TeamSide,
  TrackingMode,
} from "../types/stat-session";

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

export interface StatSessionRow {
  id: string;
  created_by: string;
  source_game_id: string | null;
  league_id: string | null;
  stage_id: string | null;
  home_name: string;
  away_name: string;
  our_side: TeamSide;
  tracking_mode: TrackingMode;
  home_roster: RosterEntry[];
  away_roster: RosterEntry[];
  game_date: string;
  tipoff_at: string | null;
  period_count: number;
  status: StatSessionStatus;
  keeper_label: string;
  capture_meta: Record<string, unknown>;
}

export interface StatEventRow {
  session_id: string;
  seq: number;
  client_id: string;
  kind: StatEventKind;
  sub_type: string;
  is_successful: 0 | 1;
  team_side: TeamSide;
  jersey: string | null;
  player_name: string | null;
  period: number;
  recorded_at: string;
  source: StatEventSource;
  linked_seq: number | null;
  voided_at: string | null;
  superseded_by: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const side = (v: unknown): v is TeamSide => v === 1 || v === 2;
const nullableStr = (v: unknown): string | null => (str(v) ? v : null);

function roster(v: unknown): RosterEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((r) => ({ jerseyNumber: String(r.jerseyNumber ?? ""), playerName: String(r.playerName ?? "") }));
}

/** Columns the phone owns. finalized_at / revision / event_count belong to the finalize RPC. */
export function sessionToRow(s: StatSession): StatSessionRow {
  return {
    id: s.id,
    created_by: s.createdBy,
    source_game_id: s.sourceGameId,
    league_id: s.leagueId,
    stage_id: s.stageId,
    home_name: s.homeName,
    away_name: s.awayName,
    our_side: s.ourSide,
    tracking_mode: s.trackingMode,
    home_roster: s.homeRoster,
    away_roster: s.awayRoster,
    game_date: s.gameDate,
    tipoff_at: s.tipoffAt,
    period_count: s.periodCount,
    status: s.status,
    keeper_label: s.keeperLabel,
    capture_meta: s.captureMeta,
  };
}

export function rowToStatSession(raw: unknown): StatSession | null {
  if (!isObj(raw)) return null;
  const r = raw;
  if (!str(r.id) || !str(r.created_by) || !str(r.home_name) || !str(r.away_name) || !str(r.game_date)) return null;
  if (!side(r.our_side)) return null;
  if (r.tracking_mode !== "ours" && r.tracking_mode !== "both") return null;
  if (r.status !== "live" && r.status !== "final") return null;
  return {
    id: r.id,
    createdBy: r.created_by,
    sourceGameId: nullableStr(r.source_game_id),
    leagueId: nullableStr(r.league_id),
    stageId: nullableStr(r.stage_id),
    homeName: r.home_name,
    awayName: r.away_name,
    ourSide: r.our_side,
    trackingMode: r.tracking_mode,
    homeRoster: roster(r.home_roster),
    awayRoster: roster(r.away_roster),
    gameDate: r.game_date,
    tipoffAt: nullableStr(r.tipoff_at),
    periodCount: num(r.period_count) ? r.period_count : 4,
    status: r.status,
    finalizedAt: nullableStr(r.finalized_at),
    revision: num(r.revision) ? r.revision : 0,
    keeperLabel: str(r.keeper_label) ? r.keeper_label : "Anonymous keeper",
    eventCount: num(r.event_count) ? r.event_count : 0,
    captureMeta: isObj(r.capture_meta) ? r.capture_meta : {},
  };
}

export function eventToRow(e: StatEvent): StatEventRow {
  return {
    session_id: e.sessionId,
    seq: e.seq,
    client_id: e.clientId,
    kind: e.kind,
    sub_type: e.subType,
    is_successful: e.isSuccessful,
    team_side: e.teamSide,
    jersey: e.jersey,
    player_name: e.playerName,
    period: e.period,
    recorded_at: e.recordedAt,
    source: e.source,
    linked_seq: e.linkedSeq,
    voided_at: e.voidedAt,
    superseded_by: e.supersededBy,
  };
}

const KINDS: ReadonlySet<string> = new Set([
  "2pt", "3pt", "freethrow", "rebound", "assist", "steal", "block", "turnover", "foul", "foulon", "timeout", "period",
]);
const SOURCES: ReadonlySet<string> = new Set(["live", "tap", "batch", "manual"]);

export function rowToStatEvent(raw: unknown): StatEvent | null {
  if (!isObj(raw)) return null;
  const r = raw;
  if (!str(r.session_id) || !num(r.seq) || !str(r.client_id) || !str(r.recorded_at)) return null;
  if (!str(r.kind) || !KINDS.has(r.kind) || !side(r.team_side) || !num(r.period)) return null;
  if (!str(r.source) || !SOURCES.has(r.source)) return null;
  return {
    sessionId: r.session_id,
    seq: r.seq,
    clientId: r.client_id,
    kind: r.kind as StatEventKind,
    subType: str(r.sub_type) ? r.sub_type : "",
    isSuccessful: r.is_successful === 0 ? 0 : 1,
    teamSide: r.team_side,
    jersey: nullableStr(r.jersey),
    playerName: nullableStr(r.player_name),
    period: r.period,
    recordedAt: r.recorded_at,
    source: r.source as StatEventSource,
    linkedSeq: num(r.linked_seq) ? r.linked_seq : null,
    voidedAt: nullableStr(r.voided_at),
    supersededBy: num(r.superseded_by) ? r.superseded_by : null,
  };
}

// ---------------------------------------------------------------------------
// Writes (owner only, enforced by RLS)
// ---------------------------------------------------------------------------

export async function upsertStatSession(supabase: SupabaseClient, session: StatSession): Promise<void> {
  const { error } = await supabase.from("stat_sessions").upsert(sessionToRow(session), { onConflict: "id" });
  if (error) throw new Error(`Failed to save stat session: ${error.message}`);
}

export async function upsertStatEvents(supabase: SupabaseClient, events: StatEvent[]): Promise<void> {
  if (events.length === 0) return;
  const { error } = await supabase
    .from("stat_events")
    .upsert(events.map(eventToRow), { onConflict: "session_id,seq" });
  if (error) throw new Error(`Failed to save stat events: ${error.message}`);
}

export async function upsertStatEventPrivate(supabase: SupabaseClient, rows: StatEventPrivate[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("stat_event_private").upsert(
    rows.map((p) => ({ session_id: p.sessionId, seq: p.seq, raw_utterance: p.rawUtterance, confidence: p.confidence })),
    { onConflict: "session_id,seq" },
  );
  if (error) throw new Error(`Failed to save utterances: ${error.message}`);
}

export interface FinalizeResult {
  revision: number;
  eventCount: number;
}

/** Publishes the session. Server tokens: not_session_owner, session_not_found, tipoff_missing. */
export async function finalizeStatSession(supabase: SupabaseClient, sessionId: string): Promise<FinalizeResult> {
  const { data, error } = await supabase.rpc("finalize_stat_session", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  const d = isObj(data) ? data : {};
  return { revision: num(d.revision) ? d.revision : 0, eventCount: num(d.event_count) ? d.event_count : 0 };
}

export async function reopenStatSession(supabase: SupabaseClient, sessionId: string): Promise<{ revision: number }> {
  const { data, error } = await supabase.rpc("reopen_stat_session", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  const d = isObj(data) ? data : {};
  return { revision: num(d.revision) ? d.revision : 0 };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface StatSessionWithEvents {
  session: StatSession;
  events: StatEvent[];
}

export async function getStatSession(supabase: SupabaseClient, id: string): Promise<StatSessionWithEvents | null> {
  const { data, error } = await supabase.from("stat_sessions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load stat session: ${error.message}`);
  const session = rowToStatSession(data);
  if (!session) return null;
  const { data: rows, error: evError } = await supabase
    .from("stat_events")
    .select("*")
    .eq("session_id", id)
    .order("seq", { ascending: true });
  if (evError) throw new Error(`Failed to load stat events: ${evError.message}`);
  const events = Array.isArray(rows) ? rows.map(rowToStatEvent).filter((e): e is StatEvent => e !== null) : [];
  return { session, events };
}

/** The caller's own sessions, newest game first (live and final). */
export async function listMyStatSessions(supabase: SupabaseClient): Promise<StatSession[]> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("stat_sessions")
    .select("*")
    .eq("created_by", user.id)
    .order("game_date", { ascending: false });
  if (error) throw new Error(`Failed to list stat sessions: ${error.message}`);
  return Array.isArray(data) ? data.map(rowToStatSession).filter((s): s is StatSession => s !== null) : [];
}

/** What the desktop needs to badge a schedule row and let the user pick a keeper. */
export interface StatSessionSummary {
  id: string;
  sourceGameId: string;
  keeperLabel: string;
  trackingMode: TrackingMode;
  ourSide: TeamSide;
  eventCount: number;
  hasTipoff: boolean;
  finalizedAt: string | null;
  revision: number;
  homeName: string;
  awayName: string;
}

export function parseStatSessionSummaries(raw: unknown): Map<string, StatSessionSummary[]> {
  const out = new Map<string, StatSessionSummary[]>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (!isObj(r)) continue;
    if (!str(r.id) || !str(r.source_game_id) || !side(r.our_side) || !num(r.event_count) || !num(r.revision)) continue;
    if (r.tracking_mode !== "ours" && r.tracking_mode !== "both") continue;
    if (!str(r.home_name) || !str(r.away_name)) continue;
    const summary: StatSessionSummary = {
      id: r.id,
      sourceGameId: r.source_game_id,
      keeperLabel: str(r.keeper_label) ? r.keeper_label : "Anonymous keeper",
      trackingMode: r.tracking_mode,
      ourSide: r.our_side,
      eventCount: r.event_count,
      hasTipoff: r.has_tipoff === true,
      finalizedAt: nullableStr(r.finalized_at),
      revision: r.revision,
      homeName: r.home_name,
      awayName: r.away_name,
    };
    const list = out.get(summary.sourceGameId);
    if (list) list.push(summary);
    else out.set(summary.sourceGameId, [summary]);
  }
  return out;
}

/** Finalised sessions for a page of schedule rows, grouped by game id (empty map when none). */
export async function listStatSessionsForGames(
  supabase: SupabaseClient,
  gameIds: string[],
): Promise<Map<string, StatSessionSummary[]>> {
  if (gameIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("list_stat_sessions_for_games", { p_game_ids: gameIds });
  if (error) throw new Error(`Failed to look up stat sessions: ${error.message}`);
  return parseStatSessionSummaries(data);
}
