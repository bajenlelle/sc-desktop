/**
 * Stat session logic shared by the phone (live capture) and the desktop
 * (import): the reducer that turns parsed intents into StatEvents with
 * undo/redo/corrections, the box score, the sync anchor, and the export to
 * PlayByPlayEvent rows that the rest of Scoutable understands.
 *
 * Rules that downstream code relies on:
 * - `seq` is assigned once, strictly increasing, and never reused. Undo marks
 *   `voidedAt`; a correction inserts a new row and sets `supersededBy` on the
 *   old one. `currentEvents` is the only view the export and the box score
 *   read, so an exported eventId can disappear but never change meaning.
 * - `recordedAt` is the keeper's time for the play (utterance start or tap).
 *   The export subtracts `leadMs` and emits ISO with 3 fractional digits
 *   (the desktop WebView rejects 6).
 * - Names come from the roster snapshot by jersey; an unnamed jersey exports
 *   as "#9" so the Player filter and Leaders keep working.
 */
import type { PlayByPlayEvent } from "../types/match";
import type {
  RosterEntry,
  StatEvent,
  StatEventKind,
  StatEventSource,
  StatIntent,
  StatSession,
  TeamSide,
} from "../types/stat-session";
import type { ScheduleGame } from "./genius";
import { splitName } from "./profixio";
import { VOICE_SOURCE_PREFIX } from "./provider";

export const TIPOFF_TAP_LABEL = "the tip-off the stat keeper tapped";

// ---------------------------------------------------------------------------
// Session construction and state
// ---------------------------------------------------------------------------

type SessionInput = Pick<
  StatSession,
  "id" | "createdBy" | "homeName" | "awayName" | "ourSide" | "gameDate"
> &
  Partial<Omit<StatSession, "id" | "createdBy" | "homeName" | "awayName" | "ourSide" | "gameDate">>;

export function createStatSession(input: SessionInput): StatSession {
  return {
    sourceGameId: null,
    leagueId: null,
    stageId: null,
    trackingMode: "ours",
    homeRoster: [],
    awayRoster: [],
    tipoffAt: null,
    periodCount: 4,
    status: "live",
    finalizedAt: null,
    revision: 0,
    keeperLabel: "Anonymous keeper",
    eventCount: 0,
    captureMeta: {},
    ...input,
  };
}

export interface StatSessionState {
  session: StatSession;
  events: StatEvent[];
  nextSeq: number;
  /** Current period, derived from the newest live period row (1 before any). */
  period: number;
  /** Seqs voided by undo, newest last; cleared by any new record. */
  redo: number[];
}

export function currentEvents(events: StatEvent[]): StatEvent[] {
  return events.filter((e) => e.voidedAt === null && e.supersededBy === null).sort((a, b) => a.seq - b.seq);
}

function derivePeriod(events: StatEvent[]): number {
  let period = 1;
  let best = -1;
  for (const e of currentEvents(events)) {
    if (e.kind === "period" && e.seq > best) {
      best = e.seq;
      period = e.period;
    }
  }
  return period;
}

export function initialState(session: StatSession, events: StatEvent[] = []): StatSessionState {
  return {
    session,
    events: [...events],
    nextSeq: events.reduce((m, e) => Math.max(m, e.seq), 0) + 1,
    period: derivePeriod(events),
    redo: [],
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type NewId = () => string;

export type StatAction =
  | { type: "record"; intents: StatIntent[]; side: "ours" | "opponent"; at: string; source: StatEventSource; newClientId: NewId }
  | { type: "undo"; at: string }
  | { type: "redo" }
  | { type: "void"; seq: number; at: string }
  | {
      type: "correct";
      seq: number;
      patch: Partial<Pick<StatEvent, "kind" | "subType" | "isSuccessful" | "jersey" | "teamSide" | "period" | "recordedAt">>;
      at: string;
      newClientId: NewId;
    }
  | { type: "tipoff"; at: string; newClientId: NewId }
  | { type: "setPeriod"; period: number; at: string; newClientId: NewId };

function otherSide(side: TeamSide): TeamSide {
  return side === 1 ? 2 : 1;
}

function rosterFor(session: StatSession, side: TeamSide): RosterEntry[] {
  return side === 1 ? session.homeRoster : session.awayRoster;
}

function nameFor(session: StatSession, side: TeamSide, jersey: string | null): string | null {
  if (jersey === null) return null;
  const hit = rosterFor(session, side).find((r) => String(Number(r.jerseyNumber)) === String(Number(jersey)));
  const name = hit?.playerName.trim() ?? "";
  return name.length > 0 ? name : null;
}

interface Draft {
  kind: StatEventKind;
  subType: string;
  isSuccessful: 0 | 1;
  jersey: number | null;
  linkToShot?: boolean;
}

function draftFor(intent: StatIntent): Draft | null {
  switch (intent.kind) {
    case "shot":
      return {
        kind: intent.points === 1 ? "freethrow" : intent.points === 2 ? "2pt" : "3pt",
        subType: "",
        isSuccessful: intent.made ? 1 : 0,
        jersey: intent.jersey,
      };
    case "rebound":
      return { kind: "rebound", subType: intent.offensive ? "offensive" : "defensive", isSuccessful: 1, jersey: intent.jersey };
    case "assist":
      return { kind: "assist", subType: "", isSuccessful: 1, jersey: intent.jersey, linkToShot: true };
    case "steal":
    case "block":
    case "turnover":
    case "foulon":
      return { kind: intent.kind, subType: "", isSuccessful: 1, jersey: intent.jersey };
    case "foul":
      return { kind: "foul", subType: "personal", isSuccessful: 1, jersey: intent.jersey };
    case "timeout":
      return { kind: "timeout", subType: "", isSuccessful: 1, jersey: null };
    default:
      return null;
  }
}

function append(
  state: StatSessionState,
  row: Omit<StatEvent, "sessionId" | "seq" | "clientId" | "voidedAt" | "supersededBy">,
  newClientId: NewId,
): StatEvent {
  const ev: StatEvent = {
    sessionId: state.session.id,
    seq: state.nextSeq,
    clientId: newClientId(),
    voidedAt: null,
    supersededBy: null,
    ...row,
  };
  state.events.push(ev);
  state.nextSeq += 1;
  return ev;
}

function periodRow(state: StatSessionState, period: number, subType: string, at: string, newClientId: NewId): void {
  append(
    state,
    {
      kind: "period",
      subType,
      isSuccessful: 1,
      teamSide: state.session.ourSide,
      jersey: null,
      playerName: null,
      period,
      recordedAt: at,
      source: "tap",
      linkedSeq: null,
    },
    newClientId,
  );
  state.period = derivePeriod(state.events);
}

function undo(state: StatSessionState, at: string): void {
  const cur = currentEvents(state.events);
  const last = cur[cur.length - 1];
  if (!last) return;
  const row = state.events.find((e) => e.seq === last.seq)!;
  row.voidedAt = at;
  state.redo.push(last.seq);
  state.period = derivePeriod(state.events);
}

export function reduceStatSession(prev: StatSessionState, action: StatAction): StatSessionState {
  const state: StatSessionState = {
    session: { ...prev.session },
    events: prev.events.map((e) => ({ ...e })),
    nextSeq: prev.nextSeq,
    period: prev.period,
    redo: [...prev.redo],
  };

  switch (action.type) {
    case "record": {
      const side = action.side === "ours" ? state.session.ourSide : otherSide(state.session.ourSide);
      let lastShotSeq: number | null = null;
      for (const intent of action.intents) {
        if (intent.kind === "undo") {
          undo(state, action.at);
          continue;
        }
        if (intent.kind === "tipoff") {
          state.session.tipoffAt = action.at;
          periodRow(state, 1, "tipoff", action.at, action.newClientId);
          continue;
        }
        if (intent.kind === "period") {
          periodRow(state, intent.period ?? state.period + 1, "start", action.at, action.newClientId);
          continue;
        }
        const d = draftFor(intent);
        if (!d) continue;
        const jersey = d.jersey === null ? null : String(d.jersey);
        const ev = append(
          state,
          {
            kind: d.kind,
            subType: d.subType,
            isSuccessful: d.isSuccessful,
            teamSide: side,
            jersey,
            playerName: nameFor(state.session, side, jersey),
            period: state.period,
            recordedAt: action.at,
            source: action.source,
            linkedSeq: d.linkToShot ? lastShotSeq : null,
          },
          action.newClientId,
        );
        if (d.kind === "2pt" || d.kind === "3pt" || d.kind === "freethrow") lastShotSeq = ev.seq;
      }
      state.redo = [];
      return state;
    }
    case "undo":
      undo(state, action.at);
      return state;
    case "redo": {
      const seq = state.redo.pop();
      if (seq === undefined) return state;
      const row = state.events.find((e) => e.seq === seq);
      if (row && row.supersededBy === null) row.voidedAt = null;
      state.period = derivePeriod(state.events);
      return state;
    }
    case "void": {
      const row = state.events.find((e) => e.seq === action.seq);
      if (row && row.voidedAt === null) row.voidedAt = action.at;
      state.period = derivePeriod(state.events);
      return state;
    }
    case "correct": {
      const old = state.events.find((e) => e.seq === action.seq);
      if (!old || old.voidedAt !== null || old.supersededBy !== null) return state;
      const teamSide = action.patch.teamSide ?? old.teamSide;
      const jersey = action.patch.jersey !== undefined ? action.patch.jersey : old.jersey;
      const fresh = append(
        state,
        {
          kind: action.patch.kind ?? old.kind,
          subType: action.patch.subType ?? old.subType,
          isSuccessful: action.patch.isSuccessful ?? old.isSuccessful,
          teamSide,
          jersey,
          playerName: nameFor(state.session, teamSide, jersey),
          period: action.patch.period ?? old.period,
          recordedAt: action.patch.recordedAt ?? old.recordedAt,
          source: "manual",
          linkedSeq: old.linkedSeq,
        },
        action.newClientId,
      );
      old.supersededBy = fresh.seq;
      state.period = derivePeriod(state.events);
      return state;
    }
    case "tipoff":
      state.session.tipoffAt = action.at;
      periodRow(state, 1, "tipoff", action.at, action.newClientId);
      return state;
    case "setPeriod":
      periodRow(state, action.period, "start", action.at, action.newClientId);
      return state;
  }
}

// ---------------------------------------------------------------------------
// Box score
// ---------------------------------------------------------------------------

export interface PlayerLine {
  side: TeamSide;
  jersey: string;
  playerName: string | null;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
}

export interface TeamLine {
  pts: number;
  timeouts: number;
}

export interface BoxScore {
  players: PlayerLine[];
  team: Record<TeamSide, TeamLine>;
}

const POINTS: Partial<Record<StatEventKind, number>> = { "2pt": 2, "3pt": 3, freethrow: 1 };

export function boxScore(session: StatSession, events: StatEvent[]): BoxScore {
  const players = new Map<string, PlayerLine>();
  const team: Record<TeamSide, TeamLine> = { 1: { pts: 0, timeouts: 0 }, 2: { pts: 0, timeouts: 0 } };
  for (const e of currentEvents(events)) {
    if (e.kind === "period") continue;
    if (e.kind === "timeout") {
      team[e.teamSide].timeouts += 1;
      continue;
    }
    if (e.jersey === null) continue;
    const key = `${e.teamSide}:${e.jersey}`;
    let line = players.get(key);
    if (!line) {
      line = {
        side: e.teamSide, jersey: e.jersey, playerName: e.playerName ?? nameFor(session, e.teamSide, e.jersey),
        pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
      };
      players.set(key, line);
    }
    const pts = POINTS[e.kind];
    if (pts !== undefined) {
      const made = e.isSuccessful === 1;
      if (e.kind === "freethrow") {
        line.fta += 1;
        if (made) line.ftm += 1;
      } else {
        line.fga += 1;
        if (made) line.fgm += 1;
        if (e.kind === "3pt") {
          line.tpa += 1;
          if (made) line.tpm += 1;
        }
      }
      if (made) {
        line.pts += pts;
        team[e.teamSide].pts += pts;
      }
      continue;
    }
    switch (e.kind) {
      case "rebound": e.subType === "offensive" ? (line.oreb += 1) : (line.dreb += 1); break;
      case "assist": line.ast += 1; break;
      case "steal": line.stl += 1; break;
      case "block": line.blk += 1; break;
      case "turnover": line.tov += 1; break;
      case "foul": line.pf += 1; break;
      default: break;
    }
  }
  const sorted = [...players.values()].sort((a, b) => a.side - b.side || Number(a.jersey) - Number(b.jersey));
  return { players: sorted, team };
}

// ---------------------------------------------------------------------------
// Export to PlayByPlayEvent
// ---------------------------------------------------------------------------

function byTime(a: StatEvent, b: StatEvent): number {
  return Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.seq - b.seq;
}

function isoMinus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) - ms).toISOString();
}

export interface ExportOptions {
  /** Milliseconds the keeper's timestamps run behind the play (speech latency). */
  leadMs?: number;
}

export function statEventsToPlayByPlay(
  session: StatSession,
  events: StatEvent[],
  opts: ExportOptions = {},
): PlayByPlayEvent[] {
  const leadMs = opts.leadMs ?? 0;
  const rows = currentEvents(events).filter((e) => e.kind !== "period").sort(byTime);
  const score = { 1: 0, 2: 0 } as Record<TeamSide, number>;
  const out: PlayByPlayEvent[] = [];
  for (const e of rows) {
    const pts = POINTS[e.kind];
    if (pts !== undefined && e.isSuccessful === 1) score[e.teamSide] += pts;
    const jerseyNum = e.jersey === null ? null : Number(e.jersey);
    const name = e.playerName ? splitName(e.playerName) : null;
    out.push({
      eventId: e.seq,
      type: e.kind,
      subType: e.subType,
      period: Math.max(1, e.period),
      gameClockTime: "",
      realWorldTime: isoMinus(e.recordedAt, leadMs),
      isSuccessful: e.isSuccessful,
      player:
        jerseyNum === null || !Number.isInteger(jerseyNum)
          ? null
          : {
              playerId: e.teamSide * 1000 + jerseyNum,
              pno: jerseyNum,
              firstName: name?.firstName || `#${jerseyNum}`,
              familyName: name ? name.familyName : "",
              teamNumber: e.teamSide,
            },
      eventTeam: {
        teamCode: "",
        teamName: e.teamSide === 1 ? session.homeName : session.awayName,
        teamNumber: e.teamSide,
      },
      qualifiers: [],
      x: null,
      y: null,
      area: null,
      shotClock: null,
      previousAction: e.linkedSeq,
      onCourtHome: null,
      onCourtAway: null,
      scoreHome: score[1],
      scoreAway: score[2],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync anchor and desktop shapes
// ---------------------------------------------------------------------------

export interface VoiceSyncAnchor {
  realWorldTime: string;
  kind: "match_start" | "first_basket";
  label: string;
}

export function findVoiceSyncAnchor(session: StatSession, events: StatEvent[]): VoiceSyncAnchor | null {
  if (session.tipoffAt) return { realWorldTime: session.tipoffAt, kind: "match_start", label: TIPOFF_TAP_LABEL };
  const score = { 1: 0, 2: 0 } as Record<TeamSide, number>;
  for (const e of currentEvents(events).sort(byTime)) {
    const pts = POINTS[e.kind];
    if (pts === undefined || e.isSuccessful !== 1) continue;
    score[e.teamSide] += pts;
    if (e.teamSide === session.ourSide) {
      const ourName = session.ourSide === 1 ? session.homeName : session.awayName;
      return {
        realWorldTime: e.recordedAt,
        kind: "first_basket",
        label: `${ourName}'s first basket (${score[1]}–${score[2]})`,
      };
    }
  }
  return null;
}

/** Mirrors the desktop's GameData (apps/desktop/src/lib/basketball-api.ts). */
export interface VoiceGameData {
  homeName: string;
  awayName: string;
  date: string;
  homeRoster: RosterEntry[];
  awayRoster: RosterEntry[];
  events: PlayByPlayEvent[];
  tipoffRealWorldTime: string | null;
  syncAnchor?: { kind: "match_start" | "first_basket"; label: string };
  pbpStatus: "ok" | "empty";
}

function mergeRoster(snapshot: RosterEntry[], lineup: RosterEntry[] | undefined): RosterEntry[] {
  const byJersey = new Map<string, RosterEntry>();
  for (const r of snapshot) byJersey.set(String(Number(r.jerseyNumber)), { ...r });
  for (const l of lineup ?? []) {
    const key = String(Number(l.jerseyNumber));
    const cur = byJersey.get(key);
    if (cur) {
      if (l.playerName.trim()) cur.playerName = l.playerName;
    } else {
      byJersey.set(key, { ...l });
    }
  }
  return [...byJersey.values()].sort((a, b) => Number(a.jerseyNumber) - Number(b.jerseyNumber));
}

export function voiceSessionToGameData(
  session: StatSession,
  events: StatEvent[],
  opts: ExportOptions & { lineups?: { home: RosterEntry[]; away: RosterEntry[] } } = {},
): VoiceGameData {
  const pbp = statEventsToPlayByPlay(session, events, opts);
  const anchor = findVoiceSyncAnchor(session, events);
  return {
    homeName: session.homeName,
    awayName: session.awayName,
    date: session.gameDate,
    homeRoster: mergeRoster(session.homeRoster, opts.lineups?.home),
    awayRoster: mergeRoster(session.awayRoster, opts.lineups?.away),
    events: pbp,
    tipoffRealWorldTime: anchor ? isoMinus(anchor.realWorldTime, 0) : null,
    ...(anchor ? { syncAnchor: { kind: anchor.kind, label: anchor.label } } : {}),
    pbpStatus: pbp.length > 0 ? "ok" : "empty",
  };
}

/** A session as a row in the desktop's "My recorded games" list. */
export function statSessionToScheduleGame(session: StatSession, events: StatEvent[]): ScheduleGame {
  const box = boxScore(session, events);
  const start = session.tipoffAt ?? `${session.gameDate}T00:00:00.000Z`;
  const status = session.status === "final" ? "COMPLETE" : "IN_PROGRESS";
  return {
    uuid: `${VOICE_SOURCE_PREFIX}${session.id}`,
    rawStartDateTime: start,
    startDateTime: start,
    homeTeamInfo: { names: { short: session.homeName, long: session.homeName }, score: box.team[1].pts, icon: "", status },
    awayTeamInfo: { names: { short: session.awayName, long: session.awayName }, score: box.team[2].pts, icon: "", status },
    venueInfo: { name: session.keeperLabel },
  };
}
