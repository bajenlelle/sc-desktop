/**
 * A playlist's scouting report draft in the database (`scouting_report_drafts`,
 * migration 20261101100000): one row per playlist, owner-only, written by the
 * desktop as the coach edits. Isomorphic: callers pass their platform Supabase
 * client. The draft itself is lib/report-draft.ts; publishing is
 * lib/scouting-reports-db.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUserId } from "./current-user";
import { REPORT_DRAFT_MAX_BYTES, draftBytes, parseReportDraft, type ReportDraft } from "./report-draft";
import { reportDbError } from "./report";

const TABLE = "scouting_report_drafts";

export interface StoredReportDraft {
  draft: ReportDraft;
  updatedAt: string;
}

/**
 * The playlist's draft, or null when it has none. Throws when the read fails
 * or the row can't be read: "none" would let the next edit write an empty
 * draft over the stored one.
 */
export async function getReportDraft(supabase: SupabaseClient, playlistId: string): Promise<StoredReportDraft | null> {
  const { data, error } = await supabase.from(TABLE).select("content, updated_at").eq("playlist_id", playlistId).maybeSingle();
  if (error) {
    reportDbError("getReportDraft", error);
    throw new Error(`Failed to load report draft: ${error.message}`);
  }
  if (!data) return null;
  const row = data as { content: unknown; updated_at: string };
  const draft = parseReportDraft(row.content);
  if (!draft) {
    reportDbError("getReportDraft", { message: `unreadable draft for playlist ${playlistId}` });
    throw new Error("unreadable_draft");
  }
  return { draft, updatedAt: row.updated_at };
}

/**
 * Writes the draft (insert or update). The caller prunes placements first.
 * Throws `draft_too_large` before sending a draft the table's check would
 * refuse, `not_authenticated` with no session, else the write's error.
 */
export async function saveReportDraft(supabase: SupabaseClient, playlistId: string, draft: ReportDraft): Promise<{ updatedAt: string }> {
  if (draftBytes(draft) > REPORT_DRAFT_MAX_BYTES) throw new Error("draft_too_large");
  const userId = await currentUserId(supabase);
  if (!userId) throw new Error("not_authenticated");
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ playlist_id: playlistId, user_id: userId, content: draft }, { onConflict: "playlist_id" })
    .select("updated_at")
    .single();
  if (error) throw new Error(`Failed to save report draft: ${error.message}`);
  return { updatedAt: (data as { updated_at: string }).updated_at };
}

export async function deleteReportDraft(supabase: SupabaseClient, playlistId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("playlist_id", playlistId);
  if (error) throw new Error(`Failed to delete report draft: ${error.message}`);
}

/** Which of the caller's playlists have a report draft, by id. Empty when the read fails. */
export async function listReportDraftPlaylistIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from(TABLE).select("playlist_id");
  if (error) {
    reportDbError("listReportDraftPlaylistIds", error);
    return new Set();
  }
  return new Set(((data ?? []) as { playlist_id: string }[]).map((r) => r.playlist_id));
}
