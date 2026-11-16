/**
 * A game's marks (types/game-marks.ts): its timeouts and each period's start
 * and end, read from the league feed's rows that never become plays. Pure:
 * the fetch and the save are game-marks-fill.ts.
 *
 * Checked against 51 cached SBF games (2026-11-11): every game has `timeout`
 * rows, sub-type "full" with the calling team or "officials" with none; the
 * restart is the next `clock`/`start` row of the same period; rows come in
 * action-number order, while their wall-clock times step back now and then
 * (late entries), so "next" always means by action number.
 */
import type { GameMarks, GameMarksBasis, GamePeriodBounds, GameTimeout } from "../types/game-marks";
import type { PlayByPlayEvent } from "../types/match";
import { gameClock, globalPeriod, toIsoUtc, type GeniusAction } from "./genius";

/** More than any game has; a guard on what is stored, not a rule of the sport. */
const MAX_TIMEOUTS = 60;
const MAX_PERIODS = 20;

const msOf = (iso: string | undefined | null) => (iso ? new Date(iso).getTime() : Number.NaN);

function scoreOf(raw: unknown): number | null {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The feed's timeouts and period bounds. `homeTeamId` tells the sides apart
 * (score1 is the home side). A period's first start and last end win, as in
 * findGeniusPeriodMarks.
 */
export function findGeniusGameMarks(actions: readonly GeniusAction[], homeTeamId: number): GameMarks {
  const ordered = [...actions].sort((a, b) => a.actionNumber - b.actionNumber);
  const periods: Record<string, GamePeriodBounds> = {};
  const timeouts: GameTimeout[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    if (a.actionType !== "period" && a.actionType !== "timeout") continue;
    const period = globalPeriod(a.period, a.periodType ?? "");
    if (!Number.isInteger(period) || period < 1 || !a.timeActual) continue;
    const at = toIsoUtc(a.timeActual);
    const atMs = msOf(at);
    if (!Number.isFinite(atMs)) continue;

    if (a.actionType === "period") {
      const bounds = (periods[String(period)] ??= {});
      if (a.subType === "start" && !bounds.startRealWorldTime) bounds.startRealWorldTime = at;
      else if (a.subType === "end") bounds.endRealWorldTime = at;
      continue;
    }

    let resume: string | undefined;
    for (let j = i + 1; j < ordered.length; j++) {
      const next = ordered[j];
      if (globalPeriod(next.period, next.periodType ?? "") !== period) break;
      if (next.actionType !== "clock" || next.subType !== "start" || !next.timeActual) continue;
      const t = toIsoUtc(next.timeActual);
      if (msOf(t) >= atMs) {
        resume = t;
        break;
      }
    }
    const officials = a.subType === "officials" || !a.teamId;
    timeouts.push({
      eventId: a.actionNumber,
      period,
      clock: gameClock(a.clock ?? ""),
      realWorldTime: at,
      ...(resume ? { resumeRealWorldTime: resume } : {}),
      kind: officials ? "officials" : "team",
      teamNumber: officials ? null : a.teamId === homeTeamId ? 1 : 2,
      scoreHome: scoreOf(a.score1),
      scoreAway: scoreOf(a.score2),
    });
  }
  return { v: 1, source: "genius", periods, timeouts };
}

/**
 * Timeouts a feed keeps among its plays (a `timeout` row, as Profixio's
 * normaliser writes): the same marks without a fetch. Null when there are none.
 */
export function gameMarksFromEvents(events: readonly PlayByPlayEvent[]): GameMarks | null {
  const timeouts: GameTimeout[] = [];
  for (const e of events) {
    if (e.type !== "timeout" || !Number.isFinite(msOf(e.realWorldTime))) continue;
    const team = e.eventTeam?.teamNumber;
    const teamNumber = team === 1 || team === 2 ? team : null;
    timeouts.push({
      eventId: e.eventId,
      period: e.period,
      clock: e.gameClockTime ?? "",
      realWorldTime: e.realWorldTime,
      kind: teamNumber ? "team" : "officials",
      teamNumber,
      scoreHome: e.scoreHome ?? null,
      scoreAway: e.scoreAway ?? null,
    });
  }
  if (timeouts.length === 0) return null;
  timeouts.sort((a, b) => a.period - b.period || a.eventId - b.eventId);
  return { v: 1, source: "events", periods: {}, timeouts };
}

/** What marks are read against: how many plays, and the first and last play's time. */
export function gameMarksBasis(events: readonly PlayByPlayEvent[]): GameMarksBasis {
  let first = "";
  let last = "";
  let firstMs = Infinity;
  let lastMs = -Infinity;
  for (const e of events) {
    const t = msOf(e.realWorldTime);
    if (!Number.isFinite(t)) continue;
    if (t < firstMs) {
      firstMs = t;
      first = e.realWorldTime;
    }
    if (t > lastMs) {
      lastMs = t;
      last = e.realWorldTime;
    }
  }
  return { plays: events.length, first, last };
}

/**
 * Whether stored marks should be read again: none yet, or the plays they were
 * read against have changed (a re-import). Marks without a basis are stale.
 */
export function gameMarksStale(marks: GameMarks | undefined | null, events: readonly PlayByPlayEvent[]): boolean {
  if (!marks?.basis) return true;
  const now = gameMarksBasis(events);
  return marks.basis.plays !== now.plays || marks.basis.first !== now.first || marks.basis.last !== now.last;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isoOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" && Number.isFinite(msOf(v)) ? v : undefined;

/**
 * The stored column back as marks, dropping anything malformed: the database
 * checks only that it is an object of a sane size. Undefined when it isn't
 * marks at all.
 */
export function normalizeGameMarks(raw: unknown): GameMarks | undefined {
  if (!isRecord(raw) || raw.v !== 1) return undefined;
  if (raw.source !== "genius" && raw.source !== "events") return undefined;

  const periods: Record<string, GamePeriodBounds> = {};
  if (isRecord(raw.periods)) {
    for (const [key, value] of Object.entries(raw.periods).slice(0, MAX_PERIODS)) {
      const p = Number(key);
      if (!Number.isInteger(p) || p < 1 || !isRecord(value)) continue;
      const start = isoOrUndefined(value.startRealWorldTime);
      const end = isoOrUndefined(value.endRealWorldTime);
      if (start || end) {
        periods[String(p)] = { ...(start ? { startRealWorldTime: start } : {}), ...(end ? { endRealWorldTime: end } : {}) };
      }
    }
  }

  const timeouts: GameTimeout[] = [];
  if (Array.isArray(raw.timeouts)) {
    for (const t of raw.timeouts.slice(0, MAX_TIMEOUTS)) {
      if (!isRecord(t)) continue;
      const at = isoOrUndefined(t.realWorldTime);
      if (!at || typeof t.eventId !== "number" || !Number.isFinite(t.eventId)) continue;
      if (typeof t.period !== "number" || !Number.isInteger(t.period) || t.period < 1) continue;
      const teamNumber = t.teamNumber === 1 || t.teamNumber === 2 ? t.teamNumber : null;
      const resume = isoOrUndefined(t.resumeRealWorldTime);
      timeouts.push({
        eventId: t.eventId,
        period: t.period,
        clock: typeof t.clock === "string" ? t.clock : "",
        realWorldTime: at,
        ...(resume ? { resumeRealWorldTime: resume } : {}),
        kind: t.kind === "officials" || teamNumber === null ? "officials" : "team",
        teamNumber: t.kind === "officials" ? null : teamNumber,
        scoreHome: scoreOf(t.scoreHome),
        scoreAway: scoreOf(t.scoreAway),
      });
    }
  }

  const basis =
    isRecord(raw.basis) &&
    typeof raw.basis.plays === "number" &&
    typeof raw.basis.first === "string" &&
    typeof raw.basis.last === "string"
      ? { plays: raw.basis.plays, first: raw.basis.first, last: raw.basis.last }
      : undefined;

  return { v: 1, source: raw.source, periods, timeouts, ...(basis ? { basis } : {}) };
}

/** A game's marks: the stored ones, else those its own plays carry. Null when it has neither. */
export function resolveGameMarks(match: { gameMarks?: GameMarks | null; events: readonly PlayByPlayEvent[] }): GameMarks | null {
  return match.gameMarks ?? gameMarksFromEvents(match.events);
}
