/**
 * Server calls for moving content from a personal space into a club
 * (get_move_to_club_preview / move_to_club, 20261028100000_move_to_club.sql).
 *
 * Each function accepts a SupabaseClient so this module is isomorphic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LicenseState } from "./license-state";
import type {
  MergeBlockReason,
  MoveErrorToken,
  MoveGame,
  MovePlaylist,
  MovePreview,
  MoveRequest,
  MoveResult,
} from "../types/space-move";

const ERROR_TOKENS: readonly MoveErrorToken[] = [
  "not_authenticated",
  "target_not_club",
  "not_staff",
  "license_locked",
  "no_personal_space",
  "nothing_to_move",
  "too_many",
  "not_movable",
  "demo_not_movable",
  "folder_has_other_space_content",
  "merge_incomplete",
];

const LICENSE_STATES: readonly LicenseState[] = ["active", "expiring", "grace", "locked"];
const MERGE_REASONS: readonly MergeBlockReason[] = ["stats_source_differs", "plays_differ", "video_differs"];

/** A failed move or preview; `token` says why. Nothing was changed. */
export class MoveError extends Error {
  readonly token: MoveErrorToken;
  constructor(token: MoveErrorToken, message: string) {
    super(message);
    this.name = "MoveError";
    this.token = token;
  }
}

/** The error token in a Postgres error message (RAISE EXCEPTION 'token'). */
export function moveErrorToken(message: string | null | undefined): MoveErrorToken {
  if (!message) return "unknown";
  // Longest first, so "demo_not_movable" isn't read as "not_movable".
  const byLength = [...ERROR_TOKENS].sort((a, b) => b.length - a.length);
  return byLength.find((t) => message.includes(t)) ?? "unknown";
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseGame(raw: unknown): MoveGame | null {
  if (!isObj(raw) || typeof raw.id !== "string") return null;
  const dup = isObj(raw.duplicate) && typeof raw.duplicate.club_match_id === "string" ? raw.duplicate : null;
  const reason = str(dup?.reason);
  return {
    id: raw.id,
    title: str(raw.title) ?? "Game",
    gameDate: str(raw.game_date),
    home: str(raw.home),
    away: str(raw.away),
    createdAt: str(raw.created_at) ?? "",
    duplicate: dup
      ? {
          clubMatchId: dup.club_match_id as string,
          mergeable: dup.mergeable === true,
          reason: MERGE_REASONS.includes(reason as MergeBlockReason) ? (reason as MergeBlockReason) : null,
        }
      : null,
  };
}

function parsePlaylist(raw: unknown): MovePlaylist | null {
  if (!isObj(raw) || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    name: str(raw.name) ?? "Playlist",
    folderId: str(raw.folder_id),
    createdAt: str(raw.created_at) ?? "",
    clipCount: num(raw.clip_count),
    matchIds: arr(raw.match_ids).filter((id): id is string => typeof id === "string"),
    demoClipCount: num(raw.demo_clip_count),
    otherSpaceClipCount: num(raw.other_space_clip_count),
    shared: raw.shared === true,
  };
}

export function parseMovePreview(raw: unknown): MovePreview | null {
  if (!isObj(raw) || typeof raw.personal_org_id !== "string" || !isObj(raw.target)) return null;
  const t = raw.target;
  if (typeof t.org_id !== "string") return null;
  const state = str(t.license_state);
  return {
    personalOrgId: raw.personal_org_id,
    target: {
      orgId: t.org_id,
      name: str(t.name) ?? "Club",
      planTier: str(t.plan_tier),
      licenseState: LICENSE_STATES.includes(state as LicenseState) ? (state as LicenseState) : "active",
    },
    folders: arr(raw.folders).flatMap((f) =>
      isObj(f) && typeof f.id === "string"
        ? [{ id: f.id, name: str(f.name) ?? "Folder", parentId: str(f.parent_id), sortOrder: num(f.sort_order) }]
        : [],
    ),
    playlists: arr(raw.playlists).flatMap((p) => parsePlaylist(p) ?? []),
    games: arr(raw.games).flatMap((g) => parseGame(g) ?? []),
  };
}

export function parseMoveResult(raw: unknown): MoveResult | null {
  if (!isObj(raw) || typeof raw.move_id !== "string") return null;
  return {
    moveId: raw.move_id,
    gamesMoved: num(raw.games_moved),
    gamesMerged: num(raw.games_merged),
    gamesKeptSeparate: num(raw.games_kept_separate),
    playlistsMoved: num(raw.playlists_moved),
    foldersCreated: num(raw.folders_created),
    foldersReused: num(raw.folders_reused),
    foldersRemoved: num(raw.folders_removed),
    labelsCreated: num(raw.labels_created),
    labelAssignmentsMoved: num(raw.label_assignments_moved),
    clipsRepointed: num(raw.clips_repointed),
    sharesRemoved: num(raw.shares_removed),
    merged: arr(raw.merged).flatMap((m) =>
      isObj(m) && typeof m.from === "string" && typeof m.to === "string" ? [{ from: m.from, to: m.to }] : [],
    ),
    separate: arr(raw.separate).flatMap((s) => {
      if (!isObj(s) || typeof s.match_id !== "string") return [];
      const reason = str(s.reason);
      return [
        {
          matchId: s.match_id,
          clubMatchId: str(s.club_match_id) ?? "",
          reason: MERGE_REASONS.includes(reason as MergeBlockReason) ? (reason as MergeBlockReason) : null,
        },
      ];
    }),
  };
}

/** What the picker lists for moving into `orgId`. Throws MoveError. */
export async function getMoveToClubPreview(supabase: SupabaseClient, orgId: string): Promise<MovePreview> {
  const { data, error } = await supabase.rpc("get_move_to_club_preview", { p_target_org: orgId });
  if (error) throw new MoveError(moveErrorToken(error.message), error.message);
  const preview = parseMovePreview(data);
  if (!preview) throw new MoveError("unknown", "Unexpected preview response");
  return preview;
}

/** Moves the request into `orgId` in one transaction. Throws MoveError; on error nothing moved. */
export async function moveToClub(supabase: SupabaseClient, orgId: string, req: MoveRequest): Promise<MoveResult> {
  const { data, error } = await supabase.rpc("move_to_club", {
    p_target_org: orgId,
    p_match_ids: [...new Set(req.matchIds)],
    p_playlist_ids: [...new Set(req.playlistIds)],
    p_folder_ids: [...new Set(req.folderIds)],
  });
  if (error) throw new MoveError(moveErrorToken(error.message), error.message);
  const result = parseMoveResult(data);
  if (!result) throw new MoveError("unknown", "Unexpected move response");
  return result;
}
