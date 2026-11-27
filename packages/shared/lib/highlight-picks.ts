/**
 * A player's highlight suggestions from a game's play-by-play: which of their plays are worth a clip, how good
 * each one is, which ones to pre-tick, and in what order the finished video shows them.
 *
 * A candidate is built around one moment the player made (a made basket, a block, a steal). A steal followed by the
 * same player's own basket is one candidate, because the video shows both in one clip. Scores are relative: they
 * only rank one player's plays against each other.
 *
 * Pure logic; the Highlights page feeds it the plays it already holds (see `pbp-line.ts` for the same data rules).
 */
import type { PlayByPlayEvent } from "../types/match";
import { formatGameClock, isBookkeepingEvent, parseGameClock } from "./events";

export type HighlightKind = "dunk" | "three" | "two" | "block" | "steal";

export interface HighlightCandidate {
  /** Stable across rebuilds: the game and the first event's id. */
  key: string;
  matchId: string;
  kind: HighlightKind;
  /** The plays the clip covers, in order: e.g. [steal, made layup]. */
  events: PlayByPlayEvent[];
  /** The play the clip is framed around: the made shot, or the block or steal itself. */
  anchor: PlayByPlayEvent;
  /** Contact on the made shot (a foul drawn on the shooter at the same clock). */
  andOne: boolean;
  /** Q4 or overtime, 5:00 or less left, margin of 5 or less before the play. */
  clutch: boolean;
  /** The basket put the player's team ahead, or tied it from behind. */
  goAhead: boolean;
  score: number;
}

export interface HighlightGame {
  matchId: string;
  events: PlayByPlayEvent[];
}

/** Points for what the play is; bonuses add on top. */
export const HIGHLIGHT_WEIGHTS = {
  dunk: 10,
  three: 7,
  two: 4,
  block: 5,
  steal: 4,
  andOne: 3,
  /** A steal that ends in the player's own basket, on top of the basket. */
  stealToScore: 3,
  clutch: 3,
  goAhead: 2,
  tie: 1,
} as const;

const DUNKS = new Set(["dunk", "alleyoop", "alleyoopdunk", "tipindunk"]);
/** A steal becomes part of the player's own basket if the basket comes this soon after it (wall clock). */
const STEAL_TO_SCORE_MS = 10_000;

const isMadeShot = (e: PlayByPlayEvent) => (e.type === "2pt" || e.type === "3pt") && e.isSuccessful === 1;
const clockSeconds = (e: PlayByPlayEvent) => parseGameClock(formatGameClock(e.gameClockTime ?? ""));
const wallMs = (e: PlayByPlayEvent) => (e.realWorldTime ? new Date(e.realWorldTime).getTime() : Number.NaN);

/** The player's team's lead after the play (negative when behind), or null when the feed has no running score. */
function leadAfter(e: PlayByPlayEvent): number | null {
  if (e.scoreHome == null || e.scoreAway == null || !e.player) return null;
  const home = e.player.teamNumber === 1;
  return home ? e.scoreHome - e.scoreAway : e.scoreAway - e.scoreHome;
}

function shotPoints(e: PlayByPlayEvent): number {
  return e.type === "3pt" ? 3 : 2;
}

/**
 * Every highlight candidate for one player in one game, in game order. Plays without a wall-clock time are left out
 * (they can't be placed in the video), and so are team rows and bookkeeping.
 */
export function highlightCandidates(game: HighlightGame, playerId: number | string): HighlightCandidate[] {
  const id = String(playerId);
  const mine = (e: PlayByPlayEvent) => !!e.player && String(e.player.playerId) === id;
  const plays = game.events.filter((e) => !isBookkeepingEvent(e) && Number.isFinite(wallMs(e)));
  plays.sort((a, b) => a.period - b.period || wallMs(a) - wallMs(b) || a.eventId - b.eventId);

  const used = new Set<number>();
  const out: HighlightCandidate[] = [];
  for (let i = 0; i < plays.length; i++) {
    const e = plays[i];
    if (!mine(e) || used.has(e.eventId)) continue;

    if (e.type === "steal") {
      const basket = plays.slice(i + 1).find((s) => s.period === e.period && wallMs(s) - wallMs(e) <= STEAL_TO_SCORE_MS && isMadeShot(s));
      if (basket && mine(basket)) {
        used.add(basket.eventId);
        out.push(shotCandidate(game.matchId, [e, basket], basket, plays, mine));
      } else {
        out.push(plainCandidate(game.matchId, e, "steal"));
      }
      continue;
    }
    if (e.type === "block") {
      out.push(plainCandidate(game.matchId, e, "block"));
      continue;
    }
    if (isMadeShot(e)) out.push(shotCandidate(game.matchId, [e], e, plays, mine));
  }
  return out;
}

function plainCandidate(matchId: string, e: PlayByPlayEvent, kind: HighlightKind): HighlightCandidate {
  const clutch = isClutch(e, leadAfter(e));
  const score = HIGHLIGHT_WEIGHTS[kind as "block" | "steal"] + (clutch ? HIGHLIGHT_WEIGHTS.clutch : 0);
  return { key: `${matchId}:${e.eventId}`, matchId, kind, events: [e], anchor: e, andOne: false, clutch, goAhead: false, score };
}

function shotCandidate(
  matchId: string,
  events: PlayByPlayEvent[],
  shot: PlayByPlayEvent,
  plays: PlayByPlayEvent[],
  mine: (e: PlayByPlayEvent) => boolean,
): HighlightCandidate {
  const kind: HighlightKind = DUNKS.has(shot.subType ?? "") ? "dunk" : shot.type === "3pt" ? "three" : "two";
  const clock = clockSeconds(shot);
  const andOne = clock >= 0 && plays.some((p) => p.type === "foulon" && mine(p) && p.period === shot.period && Math.abs(clockSeconds(p) - clock) <= 1);
  const after = leadAfter(shot);
  const before = after == null ? null : after - shotPoints(shot);
  const clutch = isClutch(shot, before);
  const goAhead = before != null && after != null && before <= 0 && after > 0;
  const tie = before != null && after === 0 && before < 0;

  const w = HIGHLIGHT_WEIGHTS;
  let score = w[kind as "dunk" | "three" | "two"];
  if (andOne) score += w.andOne;
  if (events.length > 1) score += w.stealToScore;
  if (clutch) score += w.clutch;
  if (goAhead) score += w.goAhead;
  else if (tie) score += w.tie;
  return { key: `${matchId}:${events[0].eventId}`, matchId, kind, events, anchor: shot, andOne, clutch, goAhead, score };
}

/** Q4 or overtime, 5:00 or less on the clock, and the game within 5 before the play. */
function isClutch(e: PlayByPlayEvent, leadBefore: number | null): boolean {
  if (e.period < 4 || leadBefore == null) return false;
  const left = clockSeconds(e);
  return left >= 0 && left <= 300 && Math.abs(leadBefore) <= 5;
}

/** Seconds a candidate takes in the finished video, before the framing trims it. */
export function estimatedSeconds(c: HighlightCandidate): number {
  return c.events.length > 1 ? 5 : 3.5;
}

/**
 * The candidates to tick by default: the best ones, until the video reaches about `targetSeconds`, at least
 * `min` and at most `max`. Ties go to the later play (closer to the end of the game).
 */
export function pickHighlights(
  candidates: HighlightCandidate[],
  opts: { targetSeconds?: number; min?: number; max?: number } = {},
): Set<string> {
  const { targetSeconds = 30, min = 4, max = 10 } = opts;
  const ranked = rank(candidates);
  const picked = new Set<string>();
  let seconds = 0;
  for (const c of ranked) {
    if (picked.size >= max || (picked.size >= min && seconds >= targetSeconds)) break;
    picked.add(c.key);
    seconds += estimatedSeconds(c);
  }
  return picked;
}

function rank(candidates: HighlightCandidate[]): HighlightCandidate[] {
  const order = new Map(candidates.map((c, i) => [c.key, i]));
  return [...candidates].sort((a, b) => b.score - a.score || order.get(b.key)! - order.get(a.key)!);
}

/**
 * The order the video shows the picked plays in: the best play first (the hook), then the rest in game order, with
 * the second best saved for last. Candidates must be in game order (as `highlightCandidates` returns them; for
 * several games, concatenate the games in date order).
 */
export function highlightOrder(picked: HighlightCandidate[]): HighlightCandidate[] {
  if (picked.length <= 2) return rank(picked);
  const [best, second] = rank(picked);
  const middle = picked.filter((c) => c.key !== best.key && c.key !== second.key);
  return [best, ...middle, second];
}
