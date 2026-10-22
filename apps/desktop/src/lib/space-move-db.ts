/**
 * Desktop wrapper — binds the platform Supabase client to the shared DB lib.
 * All logic lives in @scoutable/shared/lib/space-move-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/space-move-db";
import type { MoveRequest } from "@scoutable/shared/types/space-move";

const c = () => createClient();

export const getMoveToClubPreview = (orgId: string) => db.getMoveToClubPreview(c(), orgId);
export const moveToClub = (orgId: string, req: MoveRequest) => db.moveToClub(c(), orgId, req);
