/**
 * Desktop wrapper — binds the platform Supabase client to the shared DB lib.
 * All logic lives in @scoutable/shared/lib/matches-db.
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/matches-db";
import type { StoredMatch, SyncPoint } from "@/types/match";

const c = () => createClient();

// Import and delete both move the monthly quota — announce them so the
// always-mounted plan badge (use-import-quota) can re-count.
export const saveMatch = async (match: StoredMatch, opts?: { refreshEvents?: boolean }) => {
  await db.saveMatch(c(), match, opts);
  window.dispatchEvent(new CustomEvent("matches-changed"));
};
export const findMatchBySourceGame = (sourceGameId: string, orgId?: string) =>
  db.findMatchBySourceGame(c(), sourceGameId, orgId);
export const getMatch = (id: string) => db.getMatch(c(), id);
export const listMatches = (orgId?: string, opts?: { ownOnly?: boolean }) => db.listMatches(c(), orgId, opts);
export const listEventsForMatches = (matchIds: string[]) => db.listEventsForMatches(c(), matchIds);
// Announced so open pages (playlists' matchLookup, Library badges) pick up
// the new sync point without a remount.
export const updateSyncPoint = async (matchId: string, syncPoint: SyncPoint | null) => {
  await db.updateSyncPoint(c(), matchId, syncPoint);
  window.dispatchEvent(new CustomEvent("matches-changed"));
};
// Announced so open pages (Library badges, playlists probe) refresh after a relink.
export const updateVideoUrl = async (matchId: string, videoUrl: string) => {
  await db.updateVideoUrl(c(), matchId, videoUrl);
  window.dispatchEvent(new CustomEvent("matches-changed"));
};
export const updateMatchMeta = async (
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
) => {
  await db.updateMatchMeta(c(), matchId, updates);
  window.dispatchEvent(new CustomEvent("matches-changed"));
};
export const deleteMatch = async (matchId: string) => {
  await db.deleteMatch(c(), matchId);
  window.dispatchEvent(new CustomEvent("matches-changed"));
};
export const listFolders = (orgId?: string, opts?: { includeUnscoped?: boolean }) => db.listFolders(c(), orgId, opts);
export const createFolder = (name: string, parentId?: string, orgId?: string) => db.createFolder(c(), name, parentId, orgId);
export const updateFolder = (id: string, patch: { name?: string; sortOrder?: number; parentId?: string | null }) => db.updateFolder(c(), id, patch);
export const deleteFolder = (id: string) => db.deleteFolder(c(), id);
export const listMatchesLight = (orgId?: string, opts?: { ownOnly?: boolean; includeUnscoped?: boolean }) =>
  db.listMatchesLight(c(), orgId, opts);
export const countMatchesThisMonth = () => db.countMatchesThisMonth(c());
export const countClubMatchesThisMonth = (ntLeagueIds: string[], orgId?: string) => db.countClubMatchesThisMonth(c(), ntLeagueIds, orgId);
export const seedDemoMatch = (orgId: string) => db.seedDemoMatch(c(), orgId);
