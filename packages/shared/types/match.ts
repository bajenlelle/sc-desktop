// =============================================================================
// Basketball AI Analytics — Core Data Types
// Derived from the AI engine's output structures (ByteTrack + RF-DETR + OCR)
// =============================================================================

import type { CropKeyframe } from '../lib/crop-path';
export type { CropKeyframe };

export type MatchStatus = "pending" | "processing" | "completed" | "failed";
export type EventOutcome = "success" | "miss" | "turnover" | "foul";
export type EventType =
  | "jump_shot"
  | "three_pointer"
  | "free_throw"
  | "layup"
  | "dunk"
  | "pass"
  | "assist"
  | "rebound"
  | "steal"
  | "block"
  | "turnover"
  | "foul";

// --- Team & Player -----------------------------------------------------------

export interface Player {
  id: string;
  jerseyNumber: number;
  name: string;
  teamId: string;
}

export interface PlayerStats {
  playerId: string;
  jerseyNumber: number;
  playerName: string;
  teamId: string;
  totalActions: number;
  jumpShots: { made: number; missed: number };
  threePointers: { made: number; missed: number };
  freeThrows: { made: number; missed: number };
  passes: number;
  assists: number;
  rebounds: number;
  steals: number;
  blocks: number;
  turnovers: number;
  successRate: number; // 0–100
}

export interface Team {
  id: string;
  name: string;
  color: string; // hex
  players: Player[];
}

export interface TeamStats {
  teamId: string;
  teamName: string;
  totalShots: number;
  shotsMade: number;
  shootingPercentage: number;
  threePointPercentage: number;
  freeThrowPercentage: number;
  totalRebounds: number;
  totalAssists: number;
  totalSteals: number;
  totalTurnovers: number;
  possessionPercentage: number;
}

// --- Events / Timeline -------------------------------------------------------

export interface GameEvent {
  id: string;
  frameIndex: number;
  timestamp: string; // "MM:SS"
  timestampSeconds: number;
  playerId: string;
  playerName: string;
  jerseyNumber: number;
  teamId: string;
  type: EventType;
  outcome: EventOutcome;
  courtPosition?: CourtPosition;
  description: string;
}

// --- Court / Tracking --------------------------------------------------------

export interface CourtPosition {
  x: number; // feet (0–94 for NBA court)
  y: number; // feet (0–50 for NBA court)
}

export interface VideoBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlayerPosition {
  playerId: string;
  trackerId: number;
  videoBox: VideoBox;
  courtPosition?: CourtPosition;
  confidence: number;
}

export interface FrameData {
  index: number;
  timestamp: number; // seconds
  playerPositions: PlayerPosition[];
}

// --- Play-by-Play (Genius Sports Warehouse API) ------------------------------

export interface PlayByPlayEvent {
  eventId: number;
  type: string;       // "2pt", "3pt", "freethrow", "rebound", "turnover", "steal", "foul", "foulon", "block", "assist"
  subType: string;    // "jumpshot", "offensive", "defensive", "badpass", "start", etc.
  period: number;     // global: OT1 = 5, OT2 = 6, …
  gameClockTime: string; // "MM:SS" countdown
  realWorldTime: string; // ISO UTC — used for video sync
  isSuccessful: number;  // 1 = made/success, 0 = miss
  player?: {
    playerId: number;
    pno: number;
    firstName: string;
    familyName: string;
    teamNumber: number; // 1 = home, 2 = away
  } | null;
  eventTeam?: {
    teamCode: string;
    teamName: string;
    teamNumber: number;
  } | null;
  qualifiers: string[];
  // Genius-only fields below — null/absent on matches imported from the old
  // scrape. All optional so pre-Genius rows and readers are unaffected.
  x?: number | null;              // shot coords, 0-100 court space (shots only)
  y?: number | null;
  area?: string | null;           // named zone: "underbasket", "outsideleftwing", …
  shotClock?: string | null;      // schema-ready; all zeros in the feed so far
  previousAction?: number | null; // actionNumber this one follows (assist → shot)
  onCourtHome?: number[] | null;  // Genius personIds on court at this action
  onCourtAway?: number[] | null;
  scoreHome?: number | null;      // running score at this action
  scoreAway?: number | null;
}

export interface SyncPoint {
  syncVideoTime: number;    // seconds into the video
  syncRealWorldTime: string; // ISO UTC of the reference event (Q1 tip-off)
}

export interface PlaylistClipItem {
  type: 'clip';
  matchId: string;
  eventId: number;
  preRollOffset?: number;  // signed delta in seconds added on top of global pre-roll
  postRollOffset?: number; // signed delta in seconds added on top of global post-roll
  note?: string;           // per-clip note scoped to this playlist
  r2Url?: string;          // set after Clip & Ship upload
  groupId?: string;        // ordering-lock group (editor-only); members stay contiguous
  /** Vertical-export pan path; absent = static centered crop. See lib/crop-path.ts. */
  cropKeyframes?: CropKeyframe[];
}

export interface PlaylistTextCard {
  type: 'text';
  id: string;          // UUID, stable key
  text: string;
  durationSeconds: number;
  groupId?: string;    // ordering-lock group (editor-only); members stay contiguous
}

export type PlaylistItem = PlaylistClipItem | PlaylistTextCard;

export const isClipItem = (i: PlaylistItem): i is PlaylistClipItem => i.type === 'clip';

// Legacy alias kept for backward compatibility during migration
export type PlaylistClip = PlaylistClipItem;

export interface PlaylistFolder {
  id: string;
  name: string;
  sortOrder: number;
  parentId?: string; // references PlaylistFolder.id; undefined = root folder
  /** Org (space) this folder belongs to; undefined only for rows written by pre-org clients. */
  orgId?: string;
}

export interface Playlist {
  id: string;        // crypto.randomUUID()
  name: string;
  items: PlaylistItem[]; // ordered items (clips and text cards)
  folderId?: string; // references PlaylistFolder.id; undefined = Uncategorized
  /** Org (space) this playlist belongs to; undefined only for rows written by pre-org clients. */
  orgId?: string;
  teamId?: string;   // kept for backward compat; prefer teamIds
  teamIds?: string[]; // all teams this playlist is shared with (from playlist_shares)
  userIds?: string[]; // user IDs this playlist is directly shared with (coach view)
  directShare?: boolean; // true when current user has a direct share record (receiver view)
  createdBy?: string; // user_id of the coach who created it
  /** When this playlist was shared with the current user — drives "what's new". */
  sharedAt?: string;
  /** Who shared it. Only direct shares record this; team shares fall back to createdBy. */
  sharedBy?: string;
}

export interface StoredMatch {
  id: string;
  title: string;
  date: string;
  homeTeam: { name: string; color: string };
  awayTeam: { name: string; color: string };
  homeRoster: Array<{ jerseyNumber: string; playerName: string }>;
  awayRoster: Array<{ jerseyNumber: string; playerName: string }>;
  videoUrl?: string;
  syncPoint?: SyncPoint;
  events: PlayByPlayEvent[];
  leagueId?: string;
  /** Season the game was imported from, e.g. "2025-26". */
  seasonId?: string;
  /** Stage within the season, e.g. "regular" | "playoff". */
  stageId?: string;
  orgId?: string;
  /** Seeded sample game — excluded from quota, export/replace-video gated. */
  isDemo?: boolean;
  /** The league API's stable game uuid — dedupes re-imports in the quota log. */
  sourceGameId?: string;
}

// --- Match -------------------------------------------------------------------

export interface Match {
  id: string;
  title: string;
  date: string; // ISO date
  status: MatchStatus;
  homeTeam: Team;
  awayTeam: Team;
  videoPath?: string;
  duration?: number; // seconds
  fps?: number;
  frameCount?: number;
  playerStats?: PlayerStats[];
  events?: GameEvent[];
  homeTeamStats?: TeamStats;
  awayTeamStats?: TeamStats;
  videoUrl?: string;
  syncPoint?: SyncPoint;
  playByPlayEvents?: PlayByPlayEvent[];
  gameUuid?: string;
}
