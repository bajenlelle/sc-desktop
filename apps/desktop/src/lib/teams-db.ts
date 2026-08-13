/**
 * Desktop wrapper — binds the platform Supabase client to the shared
 * teams lib.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/teams-db";

const c = () => createClient();

export const getTeamMembers = (teamIds: string[]) => db.getTeamMembers(c(), teamIds);
export type { TeamMemberRef } from "@scoutable/shared/lib/teams-db";
