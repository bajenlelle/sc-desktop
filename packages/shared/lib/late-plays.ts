/**
 * Plays the scorer's table logged late. The league feed stamps a play with
 * the moment it was typed in, and a play the table forgot (most often a team
 * turnover) is typed in at the next break: its stamp is minutes after it
 * happened, so every clip of it shows the wrong part of the video. Its game
 * clock is still right. Such a play is found by that disagreement, and placed
 * between the plays around it by game clock.
 *
 * Pure, and the same answer every time it is asked: a feed that agrees with
 * itself is returned as it is.
 */
import type { PlayByPlayEvent } from "../types/match";
import { parseGameClock } from "./events";

/** What the search reads of a play. */
type Stamped = Pick<PlayByPlayEvent, "eventId" | "period" | "gameClockTime" | "realWorldTime" | "type">;

/**
 * A play counts as logged late only when placing it moves it this far. The
 * table's clock is corrected in steps of up to half a minute while a game is
 * on, and a play typed in a few seconds after the fact is how every play is
 * logged: neither is a late entry.
 */
export const LATE_MIN_SECONDS = 60;
/** Game clock and stamps disagree by a few seconds as a matter of course. */
const SLACK_SECONDS = 5;
/** How many of the entries after a play are read to tell whether the period went on from it. */
const FOLLOWING_PLAYS = 4;
/** The table's clock is moved forward by up to half a minute at a time when it lags: that much less time between two plays is no sign of a late entry. */
const CLOCK_CATCH_UP_SECONDS = 45;
/** An entry with this little left on its clock can be the period's last play. */
const PERIOD_END_SECONDS = 30;
/** A stoppage between two plays shorter than this isn't worth telling which side of it a play fell on. */
const STOPPAGE_SECONDS = 10;
/** After one of these the clock stands still: a play logged late between it and the next play came after the stoppage. */
const STOPS_THE_CLOCK = new Set(["foul", "foulon", "freethrow"]);

export interface LatePlay {
  eventId: number;
  /** When the play happened, as near as the plays around it tell (ISO). */
  realWorldTime: string;
  /** How long after that the table logged it. */
  lateBySeconds: number;
}

interface Row {
  eventId: number;
  clock: number;
  at: number;
  type: string;
}

const msOf = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

/** When a play at `clock` happened, from the plays logged in order before it (`seen`): between its neighbours by game clock. */
function placedAt(clock: number, seen: readonly Row[]): number | null {
  // The last play logged at or before this moment of the period, and the first one after it.
  let before: Row | null = null;
  let after: Row | null = null;
  for (const s of seen) {
    if (s.clock >= clock) {
      if (!before || s.at > before.at) before = s;
    } else if (!after || s.at < after.at) after = s;
  }
  // The clock ran at least this long on either side of the play.
  const earliest = before ? before.at + (before.clock - clock) * 1000 : null;
  const latest = after ? after.at - (clock - after.clock) * 1000 : null;
  if (earliest === null) return latest;
  if (latest === null) return earliest;
  // Stamps a second or two out can put the two bounds the wrong way round.
  if (latest <= earliest) return (earliest + latest) / 2;
  if (latest - earliest <= STOPPAGE_SECONDS * 1000) {
    const share = (before!.clock - clock) / (before!.clock - after!.clock);
    return earliest + share * (latest - earliest);
  }
  // Play stopped somewhere between the two. After a foul or a free throw it stopped there, and this play came
  // once it was on again; otherwise this play is the likelier reason it stopped.
  return STOPS_THE_CLOCK.has(before!.type) ? latest : earliest;
}

/**
 * Whether the period was played on from `row`, as the entries typed in after
 * it tell. Then the play was logged as it happened, and its clock is above
 * the period's lowest (`low`) because the table put its clock back (it had
 * run ahead): the period comes back down past `low`, and each of the next few
 * entries with a lower clock came at least as long after the play as the
 * clock ran between them. A late entry is followed by plays the clock could
 * not have reached in the time (the rest of a batch typed in together, or the
 * game going on from where it was), or by nothing that takes the period back
 * down to where it had been. A play in a period's last half minute is left
 * alone: it can be the period's last.
 */
function playedOnFrom(row: Row, rows: readonly Row[], index: number, low: number): boolean {
  if (row.clock < PERIOD_END_SECONDS) return true;
  const later = rows.slice(index + 1);
  if (!later.some((m) => m.clock <= low + SLACK_SECONDS)) return false;
  return later
    .filter((m) => m.clock < row.clock - SLACK_SECONDS)
    .slice(0, FOLLOWING_PLAYS)
    .every((m) => (m.at - row.at) / 1000 >= row.clock - m.clock - CLOCK_CATCH_UP_SECONDS);
}

/**
 * The plays of a game that were logged late, by event id. A play is one when,
 * in the order the table typed the plays in (the event ids), its game clock
 * is from before a moment the period had already passed, its stamp is after
 * that moment, the period was not played on from it (playedOnFrom), and
 * placing it moves it by a minute or more.
 */
export function findLatePlays(events: readonly Stamped[]): Map<number, LatePlay> {
  const byPeriod = new Map<number, Row[]>();
  for (const e of events) {
    const clock = e.gameClockTime ? parseGameClock(e.gameClockTime) : -1;
    const at = msOf(e.realWorldTime);
    if (!Number.isFinite(clock) || clock < 0 || !Number.isFinite(at) || !Number.isInteger(e.eventId) || e.eventId <= 0) continue;
    const rows = byPeriod.get(e.period) ?? [];
    rows.push({ eventId: e.eventId, clock, at, type: e.type });
    byPeriod.set(e.period, rows);
  }

  const late = new Map<number, LatePlay>();
  for (const rows of byPeriod.values()) {
    rows.sort((a, b) => a.eventId - b.eventId);
    const seen: Row[] = [];
    // The lowest the clock has been so far, and when it got there.
    let low = Infinity;
    let lowAt = -Infinity;
    rows.forEach((row, i) => {
      const above = seen.length > 0 && row.clock > low + SLACK_SECONDS && row.at > lowAt + SLACK_SECONDS * 1000;
      if (above && !playedOnFrom(row, rows, i, low)) {
        const at = placedAt(row.clock, seen);
        if (at !== null && row.at - at >= LATE_MIN_SECONDS * 1000) {
          late.set(row.eventId, {
            eventId: row.eventId,
            realWorldTime: new Date(Math.round(at)).toISOString(),
            lateBySeconds: Math.round((row.at - at) / 1000),
          });
          return;
        }
      }
      seen.push(row);
      // A play logged as it happened with the clock above where it had been: the table put its clock back, and
      // the period goes on from here.
      if (row.clock < low || above) {
        low = row.clock;
        lowAt = row.at;
      }
    });
  }
  return late;
}

/**
 * The game's plays with the late ones placed: `realWorldTime` is when the
 * play happened, and `loggedAt` keeps the feed's own stamp, which is how a
 * list knows to mark the play. Every other play is the object it was; a game
 * with no late play is the array it was.
 */
export function placeLatePlays<E extends Stamped & { loggedAt?: string }>(events: readonly E[]): E[] {
  // A play placed on an earlier pass is in order now, and counts as any other.
  const late = findLatePlays(events);
  if (late.size === 0) return events as E[];
  return events.map((e) => {
    const found = late.get(e.eventId);
    return found ? { ...e, realWorldTime: found.realWorldTime, loggedAt: e.loggedAt ?? e.realWorldTime } : e;
  });
}

/** Whether the play was logged late and placed by its game clock. */
export function wasLoggedLate(event: { loggedAt?: string | null }): boolean {
  return !!event.loggedAt;
}
