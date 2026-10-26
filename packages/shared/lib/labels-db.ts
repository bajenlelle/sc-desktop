/**
 * Database operations for the `labels` and `clip_label_assignments` tables.
 *
 * Vocabulary (the `labels` table) is per-(user, org). An assignment puts a
 * label on a clip, keyed by (match_id, event_id): one kind of label, shown
 * wherever that clip appears. The table's `playlist_id` column is a leftover
 * of the old playlist-scoped labels (20261030100000_unify_clip_labels.sql);
 * nothing here reads or writes it, and a later migration drops it.
 *
 * Each function accepts a SupabaseClient so this module is isomorphic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";
import type {
  ClipKey,
  ClipLabelAssignment,
  Label,
  LabelColor,
} from "../types/labels";

// ---------------------------------------------------------------------------
// Row types (snake_case from Postgres)
// ---------------------------------------------------------------------------

interface LabelRow {
  id: string;
  user_id: string;
  org_id: string;
  name: string;
  color: string;
  created_at: string;
}

interface ClipLabelAssignmentRow {
  user_id: string;
  org_id: string;
  match_id: string;
  event_id: number;
  label_id: string;
  assigned_at: string;
}

function rowToLabel(r: LabelRow): Label {
  return {
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id,
    name: r.name,
    color: r.color as LabelColor,
    createdAt: r.created_at,
  };
}

function rowToAssignment(r: ClipLabelAssignmentRow): ClipLabelAssignment {
  return {
    userId: r.user_id,
    orgId: r.org_id,
    matchId: r.match_id,
    eventId: r.event_id,
    labelId: r.label_id,
    assignedAt: r.assigned_at,
  };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export async function listLabels(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Label[]> {
  const { data, error } = await supabase
    .from("labels")
    .select("id, user_id, org_id, name, color, created_at")
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) { reportDbError("listLabels", error); return []; }
  return ((data ?? []) as LabelRow[]).map(rowToLabel);
}

export async function createLabel(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  color: LabelColor,
): Promise<Label> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("labels")
    .insert({
      user_id: user.id,
      org_id: orgId,
      name: name.trim(),
      color,
    })
    .select("id, user_id, org_id, name, color, created_at")
    .single();
  if (error || !data) throw new Error(`Failed to create label: ${error?.message}`);
  return rowToLabel(data as LabelRow);
}

export async function updateLabel(
  supabase: SupabaseClient,
  id: string,
  patch: { name?: string; color?: LabelColor },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.color !== undefined) row.color = patch.color;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("labels").update(row).eq("id", id);
  if (error) throw new Error(`Failed to update label: ${error.message}`);
}

export async function deleteLabel(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("labels").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete label: ${error.message}`);
}

/**
 * Defensive helper: if a user somehow has zero labels in this org, call the
 * SQL seed function. Auto-seed trigger + backfill should make this rare.
 */
export async function seedDefaultLabels(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error("Not authenticated");
  const { error } = await supabase.rpc("seed_default_labels", {
    p_user: user.id,
    p_org: orgId,
  });
  if (error) throw new Error(`Failed to seed labels: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/**
 * Every label the user has put on any clip of these games, in one read. A
 * game's rows are few, so callers cache per game rather than per clip.
 */
export async function listAssignmentsForMatches(
  supabase: SupabaseClient,
  orgId: string,
  matchIds: string[],
): Promise<ClipLabelAssignment[]> {
  const ids = [...new Set(matchIds)];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("clip_label_assignments")
    .select("user_id, org_id, match_id, event_id, label_id, assigned_at")
    .eq("org_id", orgId)
    .in("match_id", ids);
  if (error) {
    reportDbError("listAssignmentsForMatches", error);
    return [];
  }
  return ((data ?? []) as ClipLabelAssignmentRow[]).map(rowToAssignment);
}

/**
 * Replace-all semantics for one clip: set its labels to exactly `labelIds`.
 * Adds missing, removes extras.
 */
export async function setClipAssignments(
  supabase: SupabaseClient,
  orgId: string,
  matchId: string,
  eventId: number,
  labelIds: string[],
): Promise<void> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error("Not authenticated");

  const { data: existing, error: readErr } = await supabase
    .from("clip_label_assignments")
    .select("label_id")
    .eq("org_id", orgId)
    .eq("match_id", matchId)
    .eq("event_id", eventId);
  if (readErr) throw new Error(`Failed to read assignments: ${readErr.message}`);

  const have = new Set((existing ?? []).map((r) => (r as { label_id: string }).label_id));
  const want = new Set(labelIds);

  const toAdd = labelIds.filter((id) => !have.has(id));
  const toRemove = Array.from(have).filter((id) => !want.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase.from("clip_label_assignments").insert(
      toAdd.map((label_id) => ({
        user_id: user.id,
        org_id: orgId,
        match_id: matchId,
        event_id: eventId,
        label_id,
      })),
    );
    if (error) throw new Error(`Failed to add assignments: ${error.message}`);
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("clip_label_assignments")
      .delete()
      .eq("org_id", orgId)
      .eq("match_id", matchId)
      .eq("event_id", eventId)
      .in("label_id", toRemove);
    if (error) throw new Error(`Failed to remove assignments: ${error.message}`);
  }
}

/**
 * Bulk add or remove a single label across many clips.
 * Uses explicit diff (not upsert) because Postgrest's on_conflict doesn't
 * work with the table's partial unique indexes.
 */
export async function bulkAssign(
  supabase: SupabaseClient,
  orgId: string,
  clips: ClipKey[],
  labelId: string,
  mode: "add" | "remove",
): Promise<void> {
  if (clips.length === 0) return;
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error("Not authenticated");

  // Group by matchId for indexed lookups
  const byMatch = new Map<string, number[]>();
  for (const c of clips) {
    const list = byMatch.get(c.matchId) ?? [];
    list.push(c.eventId);
    byMatch.set(c.matchId, list);
  }

  if (mode === "add") {
    // Existence check, then insert only the missing rows.
    const existing = new Set<string>();
    await Promise.all(
      Array.from(byMatch.entries()).map(async ([matchId, eventIds]) => {
        const { data, error } = await supabase
          .from("clip_label_assignments")
          .select("event_id")
          .eq("org_id", orgId)
          .eq("match_id", matchId)
          .eq("label_id", labelId)
          .in("event_id", eventIds);
        if (error) { reportDbError("bulkAssign existence", error); return; }
        for (const r of (data ?? []) as { event_id: number }[]) {
          existing.add(`${matchId}:${r.event_id}`);
        }
      }),
    );

    const toInsert = clips
      .filter((c) => !existing.has(`${c.matchId}:${c.eventId}`))
      .map((c) => ({
        user_id: user.id,
        org_id: orgId,
        match_id: c.matchId,
        event_id: c.eventId,
        label_id: labelId,
      }));
    if (toInsert.length > 0) {
      const { error } = await supabase.from("clip_label_assignments").insert(toInsert);
      if (error) throw new Error(`Failed bulk add: ${error.message}`);
    }
    return;
  }

  // remove — one delete per match
  await Promise.all(
    Array.from(byMatch.entries()).map(async ([matchId, eventIds]) => {
      const { error } = await supabase
        .from("clip_label_assignments")
        .delete()
        .eq("org_id", orgId)
        .eq("match_id", matchId)
        .eq("label_id", labelId)
        .in("event_id", eventIds);
      if (error) throw new Error(`Failed bulk remove: ${error.message}`);
    }),
  );
}
