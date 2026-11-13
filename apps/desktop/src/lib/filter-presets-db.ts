/**
 * Desktop wrapper — binds the platform Supabase client to the shared filter presets lib.
 * All logic lives in @scoutable/shared/lib/filter-presets-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/filter-presets-db";
import type { ClipFilters } from "@scoutable/shared/lib/clip-filters";

const c = () => createClient();

export const listFilterPresets = (orgId: string) => db.listFilterPresets(c(), orgId);
export const createFilterPreset = (orgId: string, name: string, filters: ClipFilters) =>
  db.createFilterPreset(c(), orgId, name, filters);
export const renameFilterPreset = (id: string, name: string) => db.renameFilterPreset(c(), id, name);
export const deleteFilterPreset = (id: string) => db.deleteFilterPreset(c(), id);
