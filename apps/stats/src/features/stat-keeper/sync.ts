/**
 * Cloud side of a local session: whole-session upsert (idempotent on
 * (session_id, seq)), then publish through the finalize RPC. The phone is
 * the source of truth until the session is final.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  finalizeStatSession,
  reopenStatSession,
  upsertStatEventPrivate,
  upsertStatEvents,
  upsertStatSession,
} from "@scoutable/shared/lib/stat-sessions-db";
import type { StatEvent, StatEventPrivate, StatSession } from "@scoutable/shared/types/stat-session";

export async function uploadSession(
  supabase: SupabaseClient,
  session: StatSession,
  events: StatEvent[],
  privateRows: StatEventPrivate[],
): Promise<void> {
  await upsertStatSession(supabase, session);
  await upsertStatEvents(supabase, events);
  await upsertStatEventPrivate(supabase, privateRows);
}

/** Upload, then publish. Returns the new revision and event count. */
export async function publishSession(
  supabase: SupabaseClient,
  session: StatSession,
  events: StatEvent[],
  privateRows: StatEventPrivate[],
): Promise<{ revision: number; eventCount: number }> {
  await uploadSession(supabase, session, events, privateRows);
  return finalizeStatSession(supabase, session.id);
}

export async function unpublishSession(supabase: SupabaseClient, sessionId: string): Promise<{ revision: number }> {
  return reopenStatSession(supabase, sessionId);
}

/** Server error tokens → copy the keeper can act on. */
export function describeSyncError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("tipoff_missing")) return "Mark the tip-off (or record a made basket) before publishing.";
  if (msg.includes("not_authenticated")) return "You're signed out. Sign in and try again.";
  if (msg.includes("Network request failed") || msg.includes("Failed to fetch")) return "No connection. Your game is saved on this phone — try again later.";
  return msg;
}
