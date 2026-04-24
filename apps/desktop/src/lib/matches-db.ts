/**
 * Desktop wrapper — binds the platform Supabase client to the shared DB lib.
 * All logic lives in @scoutable/shared/lib/matches-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/matches-db";
import type { StoredMatch, SyncPoint } from "@/types/match";

const c = () => createClient();

export const saveMatch = (match: StoredMatch) => db.saveMatch(c(), match);
export const getMatch = (id: string) => db.getMatch(c(), id);
export const listMatches = () => db.listMatches(c());
export const listEventsForMatches = (matchIds: string[]) => db.listEventsForMatches(c(), matchIds);
export const updateSyncPoint = (matchId: string, syncPoint: SyncPoint | null) => db.updateSyncPoint(c(), matchId, syncPoint);
export const updateVideoUrl = (matchId: string, videoUrl: string) => db.updateVideoUrl(c(), matchId, videoUrl);
export const updateMatchMeta = (
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
) => db.updateMatchMeta(c(), matchId, updates);
export const deleteMatch = (matchId: string) => db.deleteMatch(c(), matchId);
export const listFolders = () => db.listFolders(c());
export const createFolder = (name: string) => db.createFolder(c(), name);
export const updateFolder = (id: string, patch: { name?: string; sortOrder?: number }) => db.updateFolder(c(), id, patch);
export const deleteFolder = (id: string) => db.deleteFolder(c(), id);
export const listMatchesLight = () => db.listMatchesLight(c());
export const countMatchesThisMonth = () => db.countMatchesThisMonth(c());
