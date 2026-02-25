// =============================================================================
// Basketball AI Analytics — Core Data Types
// Derived from the AI engine's output structures (ByteTrack + RF-DETR + OCR)
// =============================================================================

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

// --- Play-by-Play (Superettanherr API) --------------------------------------

export interface PlayByPlayEvent {
  eventId: number;
  type: string;       // "2pt", "3pt", "freethrow", "rebound", "turnover", "steal", "foul", "foulon", "block", "assist"
  subType: string;    // "jumpshot", "offensive", "defensive", "badpass", "start", etc.
  period: number;
  gameClockTime: string; // "MM:SS:CS" countdown format from API
  realWorldTime: string; // ISO UTC — used for video sync
  isSuccessful: number;  // 1 = made/success, 0 = miss
  player?: {
    playerId: number;
    pno: number;
    firstName: string;
    familyName: string;
    teamNumber: number;
  } | null;
  eventTeam?: {
    teamCode: string;
    teamName: string;
    teamNumber: number;
  } | null;
  qualifiers: string[];
}

export interface SyncPoint {
  syncVideoTime: number;    // seconds into the video
  syncRealWorldTime: string; // ISO UTC of the reference event (Q1 tip-off)
}

export interface PlaylistClip {
  matchId: string;
  eventId: number;
  preRollOffset?: number;  // signed delta in seconds added on top of global pre-roll
  postRollOffset?: number; // signed delta in seconds added on top of global post-roll
}

export interface Playlist {
  id: string;        // crypto.randomUUID()
  name: string;
  clips: PlaylistClip[]; // ordered clips (each carries its match context)
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
  playlists?: Playlist[];
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
