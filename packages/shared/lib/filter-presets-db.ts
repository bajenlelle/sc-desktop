/**
 * Database operations for the `filter_presets` table (20261112110000): a
 * coach's own named clip filters in one space. The stored shape and its
 * conversions are filter-presets.ts.
 *
 * Each function accepts a SupabaseClient so this module is isomorphic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClipFilters } from "./clip-filters";
import { parsePresetFilters, serialiseFilters, type FilterPreset } from "./filter-presets";
import { reportDbError } from "./report";

interface FilterPresetRow {
  id: string;
  name: string;
  filters: unknown;
  created_at: string;
}

const COLUMNS = "id, name, filters, created_at";

/** PostgREST's and Postgres's "no such table": a database the migration hasn't reached. */
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

/** A taken name: the unique index on (user_id, org_id, lower(name)). */
const UNIQUE_VIOLATION = "23505";

/** Null when the row's filters can't be read. */
function rowToPreset(r: FilterPresetRow): FilterPreset | null {
  const filters = parsePresetFilters(r.filters);
  if (!filters) return null;
  return { id: r.id, name: r.name, filters, createdAt: r.created_at };
}

/** The user's presets in this space, by name. A preset whose filters can't be read is left out. */
export async function listFilterPresets(
  supabase: SupabaseClient,
  orgId: string,
): Promise<FilterPreset[]> {
  const { data, error } = await supabase
    .from("filter_presets")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) {
    if (!MISSING_TABLE.has(error.code)) reportDbError("listFilterPresets", error);
    return [];
  }
  return ((data ?? []) as FilterPresetRow[])
    .map(rowToPreset)
    .filter((p): p is FilterPreset => p !== null);
}

/** Saves the filters under a name. Throws Error("duplicate_name") when the user has a preset of that name in this space. */
export async function createFilterPreset(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  filters: ClipFilters,
): Promise<FilterPreset> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error("Not authenticated");

  const stored = serialiseFilters(filters);
  const { data, error } = await supabase
    .from("filter_presets")
    .insert({ user_id: user.id, org_id: orgId, name: name.trim(), filters: stored })
    .select(COLUMNS)
    .single();
  if (error?.code === UNIQUE_VIOLATION) throw new Error("duplicate_name");
  if (error || !data) throw new Error(`Failed to save the preset: ${error?.message}`);
  const r = data as FilterPresetRow;
  return {
    id: r.id,
    name: r.name,
    filters: parsePresetFilters(r.filters) ?? parsePresetFilters(stored)!,
    createdAt: r.created_at,
  };
}

/** Throws Error("duplicate_name") when the name is taken; any other refusal (e.g. a space the user has left) is an ordinary error. */
export async function renameFilterPreset(
  supabase: SupabaseClient,
  id: string,
  name: string,
): Promise<void> {
  const { error } = await supabase.from("filter_presets").update({ name: name.trim() }).eq("id", id);
  if (error?.code === UNIQUE_VIOLATION) throw new Error("duplicate_name");
  if (error) throw new Error(`Failed to rename the preset: ${error.message}`);
}

export async function deleteFilterPreset(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("filter_presets").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete the preset: ${error.message}`);
}
