/**
 * Moving content from a personal space into a club
 * (supabase/migrations/20261028100000_move_to_club.sql).
 */
import type { LicenseState } from "../lib/license-state";

/** Why a game the club already has moves as a second copy instead of merging. */
export type MergeBlockReason = "stats_source_differs" | "plays_differ" | "video_differs";

export interface MoveDuplicate {
  /** The caller's copy of the same game in the club. */
  clubMatchId: string;
  /** True: the clips join the club copy. False: the game moves as a second copy. */
  mergeable: boolean;
  reason: MergeBlockReason | null;
}

export interface MoveTarget {
  orgId: string;
  name: string;
  planTier: string | null;
  licenseState: LicenseState;
}

export interface MoveFolder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

export interface MovePlaylist {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: string;
  clipCount: number;
  /** The caller's personal games its clips use: they move with the playlist. */
  matchIds: string[];
  /** Clips on the sample game, which stays in the personal space. */
  demoClipCount: number;
  /** Clips on games in another space, which stay where they are. */
  otherSpaceClipCount: number;
  /** Sharing left from before personal playlists became unshareable. */
  shared: boolean;
}

export interface MoveGame {
  id: string;
  title: string;
  gameDate: string | null;
  home: string | null;
  away: string | null;
  createdAt: string;
  duplicate: MoveDuplicate | null;
}

/** What the picker lists for one target club. Demo games are never listed. */
export interface MovePreview {
  personalOrgId: string;
  target: MoveTarget;
  folders: MoveFolder[];
  playlists: MovePlaylist[];
  games: MoveGame[];
}

/** What the user ticked. Folders are whole folders (their subtree moves). */
export interface MoveSelection {
  folderIds: ReadonlySet<string>;
  playlistIds: ReadonlySet<string>;
  gameIds: ReadonlySet<string>;
}

/** The smallest set of ids that describes a selection; the server expands it. */
export interface MoveRequest {
  matchIds: string[];
  playlistIds: string[];
  folderIds: string[];
}

export interface MoveResult {
  moveId: string;
  gamesMoved: number;
  gamesMerged: number;
  gamesKeptSeparate: number;
  playlistsMoved: number;
  foldersCreated: number;
  foldersReused: number;
  foldersRemoved: number;
  labelsCreated: number;
  labelAssignmentsMoved: number;
  clipsRepointed: number;
  sharesRemoved: number;
  merged: { from: string; to: string }[];
  separate: { matchId: string; clubMatchId: string; reason: MergeBlockReason | null }[];
}

export type MoveErrorToken =
  | "not_authenticated"
  | "target_not_club"
  | "not_staff"
  | "license_locked"
  | "no_personal_space"
  | "nothing_to_move"
  | "too_many"
  | "not_movable"
  | "demo_not_movable"
  | "folder_has_other_space_content"
  | "merge_incomplete"
  | "unknown";
