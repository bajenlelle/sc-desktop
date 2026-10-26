/**
 * Desktop wrapper — binds the platform Supabase client to the shared labels lib.
 * All logic lives in @scoutable/shared/lib/labels-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/labels-db";
import type { ClipKey, LabelColor } from "@scoutable/shared/types/labels";

const c = () => createClient();

export const listLabels = (orgId: string) => db.listLabels(c(), orgId);
export const createLabel = (orgId: string, name: string, color: LabelColor) =>
  db.createLabel(c(), orgId, name, color);
export const updateLabel = (id: string, patch: { name?: string; color?: LabelColor }) =>
  db.updateLabel(c(), id, patch);
export const deleteLabel = (id: string) => db.deleteLabel(c(), id);
export const seedDefaultLabels = (orgId: string) => db.seedDefaultLabels(c(), orgId);

export const listAssignmentsForMatches = (orgId: string, matchIds: string[]) =>
  db.listAssignmentsForMatches(c(), orgId, matchIds);

export const setClipAssignments = (
  orgId: string,
  matchId: string,
  eventId: number,
  labelIds: string[],
) => db.setClipAssignments(c(), orgId, matchId, eventId, labelIds);

export const bulkAssign = (
  orgId: string,
  clips: ClipKey[],
  labelId: string,
  mode: "add" | "remove",
) => db.bulkAssign(c(), orgId, clips, labelId, mode);
