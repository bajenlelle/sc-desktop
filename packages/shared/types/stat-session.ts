/**
 * Voice/tap stat keeping from a phone ("Scoutable Stats").
 *
 * A stat session is a game a keeper tracked live; its events are later
 * exported to PlayByPlayEvent rows by the desktop import (lib/stat-session.ts).
 * Everything here is platform-free so the phone app, the desktop app and the
 * tests share one vocabulary.
 */

/** PlayByPlayEvent.teamNumber convention: 1 = home, 2 = away. */
export type TeamSide = 1 | 2;

export interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

/** What the keeper can record. `period` rows mark period starts (and the tip-off). */
export type StatEventKind =
  | "2pt"
  | "3pt"
  | "freethrow"
  | "rebound"
  | "assist"
  | "steal"
  | "block"
  | "turnover"
  | "foul"
  | "foulon"
  | "timeout"
  | "period";

// --- Grammar ----------------------------------------------------------------

/** One recognised action inside an utterance. A jersey of null = team event or unknown. */
export type StatIntent =
  | { kind: "shot"; points: 1 | 2 | 3; made: boolean; jersey: number | null }
  | { kind: "rebound"; offensive: boolean; jersey: number | null }
  | { kind: "assist"; jersey: number | null }
  | { kind: "steal"; jersey: number | null }
  | { kind: "block"; jersey: number | null }
  | { kind: "turnover"; jersey: number | null }
  | { kind: "foul"; jersey: number | null }
  | { kind: "foulon"; jersey: number | null }
  | { kind: "timeout" }
  | { kind: "period"; period: number | null } // null = "next period"
  | { kind: "tipoff" }
  | { kind: "undo" };

export type ParseFailure =
  | "empty"
  | "no_event"
  | "ambiguous"
  | "two_numbers"
  | "unknown_jersey"
  | "opponent_disabled";

export type ParsedUtterance =
  | {
      ok: true;
      intents: StatIntent[];
      /** Which team the utterance is about. "ours" unless a team word said otherwise. */
      side: "ours" | "opponent";
      /** Tokens the grammar did not understand (lower the confidence shown to the keeper). */
      unconsumed: string[];
    }
  | {
      ok: false;
      reason: ParseFailure;
      /** For unknown_jersey: what was heard and the closest number on the roster. */
      jersey?: number;
      suggestion?: number;
      unconsumed: string[];
    };

export interface ParseContext {
  /** Our roster; empty = accept any jersey. */
  roster: RosterEntry[];
  /** Opponent roster when tracking both teams; empty = accept any jersey. */
  opponentRoster?: RosterEntry[];
  /** When false, utterances about the opponent fail with `opponent_disabled`. */
  trackBoth: boolean;
  /** 1 if our team is the home team (so "hemma" means us), 2 if away. */
  ourSide: TeamSide;
  ourName?: string;
  opponentName?: string;
}

// --- Session state ------------------------------------------------------------

export type StatSessionStatus = "live" | "final";
export type TrackingMode = "ours" | "both";

export interface StatSession {
  id: string;
  createdBy: string;
  /** Official game identity shared with the desktop ("profixio:<matchId>" or Genius id); null = unlinked. */
  sourceGameId: string | null;
  leagueId: string | null;
  stageId: string | null;
  homeName: string;
  awayName: string;
  ourSide: TeamSide;
  trackingMode: TrackingMode;
  homeRoster: RosterEntry[];
  awayRoster: RosterEntry[];
  /** YYYY-MM-DD */
  gameDate: string;
  /** ISO UTC of the "Start Q1" tap = the sync anchor; null until tapped. */
  tipoffAt: string | null;
  periodCount: number;
  status: StatSessionStatus;
  finalizedAt: string | null;
  revision: number;
  keeperLabel: string;
  eventCount: number;
  captureMeta: Record<string, unknown>;
}

export type StatEventSource = "live" | "tap" | "batch" | "manual";

export interface StatEvent {
  sessionId: string;
  /** Client-assigned, monotonic per session; becomes PlayByPlayEvent.eventId. Never reused. */
  seq: number;
  /** Idempotency key for offline replay. */
  clientId: string;
  kind: StatEventKind;
  /** rebound: "offensive" | "defensive"; foul: "personal" | …; otherwise "". */
  subType: string;
  /** Shots: 1 made / 0 missed. Everything else 1. */
  isSuccessful: 0 | 1;
  teamSide: TeamSide;
  /** null for team events (timeout, period). */
  jersey: string | null;
  playerName: string | null;
  period: number;
  /** ISO UTC of the play as the keeper recorded it (utterance start or tap). */
  recordedAt: string;
  source: StatEventSource;
  /** assist → the shot it belongs to */
  linkedSeq: number | null;
  /** Undo keeps the row; the export skips voided rows so eventIds never change meaning. */
  voidedAt: string | null;
  /** A correction inserts a new seq and points the old row here. */
  supersededBy: number | null;
}

/** Owner-only companion row: never leaves the keeper's account. */
export interface StatEventPrivate {
  sessionId: string;
  seq: number;
  rawUtterance: string;
  confidence: number | null;
}
