/**
 * Checking a game's sync from the game view (docs/game-view.md, "Sync").
 *
 * The plays of a game are placed in stretches: each quarter from its start,
 * and inside a quarter from each cut ("From this play on"). Within a stretch
 * every play is off by the same amount or by none, so one play seen in the
 * right place near the end of a stretch says the stretch is right: that play
 * is a check (SyncPoint.checks). A check is knowledge the next fix keeps: a
 * fix moves the plays from where it starts up to the next checked play, and
 * never that play or anything after it.
 *
 * When a play is off, the coach finds where it is, and the fix cuts the video
 * at that play. The question left is where the shift really starts: at the
 * start of the stretch (the quarter's own sync was off) or somewhere inside it
 * (the video jumps). That is narrowed down by looking at earlier plays,
 * halving the plays in doubt each time (NarrowGap): a play that looks right
 * is before the shift, a play that is off is looked for where the shift
 * would put it, and when it isn't there either it has an error of its own
 * and becomes a fix of its own.
 */
import type { PlayByPlayEvent, SyncCheck, SyncCut, SyncPoint } from "../types/match";
import { computeVideoTime, ownVideoTime } from "./clip-timing";
import { formatGameClock, periodLabel } from "./events";
import { clearSyncCut, firstPlayOfCut, periodSpans, shiftStretch, syncFromPlayOn } from "./period-sync";

/** What the checks read of a play. */
export type CheckEvent = Pick<
  PlayByPlayEvent,
  "eventId" | "period" | "realWorldTime" | "gameClockTime" | "type" | "isSuccessful" | "eventTeam" | "scoreHome" | "scoreAway" | "loggedAt"
>;

/** A play found this near to where it already is counts as right where it is. */
export const SAME_PLACE_SECONDS = 0.75;
/** A play off by less than this is most likely logged a moment late on its own: the plays around it stay. */
export const SMALL_FIX_SECONDS = 3;
/** A check plays from this long before the play to this long after it. */
export const CHECK_LEAD_SECONDS = 6;
export const CHECK_TAIL_SECONDS = 4;

/**
 * How long a check plays before and after the play, by how the game's plays
 * are timed. A Profixio table types a play in after it happens (measured
 * from 12 s before to 4 s after its stamp, 30 s at worst), so its check
 * starts well before the stamp; a league feed is to the second.
 */
export function checkWindow(provider: "genius" | "profixio"): { lead: number; tail: number } {
  return provider === "profixio" ? { lead: 20, tail: 5 } : { lead: CHECK_LEAD_SECONDS, tail: CHECK_TAIL_SECONDS };
}

const msOf = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);
/** Two places in the video this near are the same place. */
const moved = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) > 0.05;

/** One stretch of the game that is placed as a whole. */
export interface SyncPart {
  /** Its place among the game's parts. */
  index: number;
  period: number;
  /** The cut the part starts at; null when it starts with its quarter. */
  cut: SyncCut | null;
  /** Its span on the wall clock, in ms. A quarter's last part runs to the quarter's end. */
  start: number;
  end: number;
  /** "Q1", or the stretch of a quarter that a cut divides: "Q1 to 6:14", "Q1 from 6:14". */
  name: string;
  /** The checked plays in it, in time order. */
  checks: SyncCheck[];
}

/**
 * The game's parts, in order: each quarter, divided at the cuts inside it. A
 * cut that starts with its quarter (a fix made on the quarter's first plays)
 * divides nothing.
 */
export function syncParts(sync: SyncPoint, events: readonly CheckEvent[]): SyncPart[] {
  const list: CheckEvent[] = [...events];
  const parts: SyncPart[] = [];
  for (const span of periodSpans(sync, list)) {
    const cuts = (sync.cuts ?? []).filter((c) => c.period === span.period && msOf(c.syncRealWorldTime) > span.start + 1000);
    const starts: { at: number; cut: SyncCut | null }[] = [{ at: span.start, cut: null }, ...cuts.map((c) => ({ at: msOf(c.syncRealWorldTime), cut: c }))];
    const clockOf = (cut: SyncCut) => {
      const first = firstPlayOfCut(cut, list.filter((e) => e.period === span.period));
      return first?.gameClockTime ? formatGameClock(first.gameClockTime) : null;
    };
    starts.forEach((s, i) => {
      const next = starts[i + 1];
      const quarter = periodLabel(span.period);
      const from = s.cut ? clockOf(s.cut) : null;
      const to = next?.cut ? clockOf(next.cut) : null;
      const name = from && to ? `${quarter} ${from} to ${to}` : from ? `${quarter} from ${from}` : to ? `${quarter} to ${to}` : quarter;
      parts.push({ index: parts.length, period: span.period, cut: s.cut, start: s.at, end: next ? next.at : Math.max(span.end, s.at), name, checks: [] });
    });
  }
  for (const check of standingChecks(sync)) {
    const part = partOf(parts, check);
    if (part) part.checks.push(check);
  }
  return parts;
}

/**
 * The checks that still hold: the sync has the play where it was when the
 * coach confirmed it. One the sync has since moved (a tip-off changed in
 * Details, a fix from a playlist, an older desktop) says nothing any more.
 */
export function standingChecks(sync: SyncPoint): SyncCheck[] {
  return (sync.checks ?? []).filter((c) => {
    const at = computeVideoTime(c, sync);
    return at !== null && !moved(at, c.videoTime);
  });
}

/** The part a play is in: its quarter's, and of a divided quarter the one whose stretch holds the play's time. */
export function partOf(parts: readonly SyncPart[], event: { period: number; realWorldTime?: string | null }): SyncPart | null {
  const at = msOf(event.realWorldTime);
  let found: SyncPart | null = null;
  for (const part of parts) {
    if (part.period !== event.period) continue;
    // A quarter's first part takes what was logged before the quarter's own start; its last, what came after its end.
    if (found === null || (Number.isFinite(at) && at >= part.start)) found = part;
  }
  return found;
}

/** Whether a part is checked: a play in it has been seen in the right place. */
export const partChecked = (part: SyncPart) => part.checks.length > 0;

/** How much of the game is checked. */
export function syncProgress(parts: readonly SyncPart[]): { total: number; checked: number; left: number } {
  const checked = parts.filter(partChecked).length;
  return { total: parts.length, checked, left: parts.length - checked };
}

/**
 * How far a cut moves the plays after it, in seconds of video: where the cut
 * has its own moment, less where the sync before it would have had that
 * moment. Below zero the plays after it are earlier in the video than they
 * would have been (the video skips there), above zero later. Null when the
 * sync before it places nothing.
 */
export function cutShiftSeconds(sync: SyncPoint, cut: SyncCut): number | null {
  const same = (c: SyncCut) => c.period === cut.period && c.syncRealWorldTime === cut.syncRealWorldTime && c.syncVideoTime === cut.syncVideoTime;
  const before = computeVideoTime({ realWorldTime: cut.syncRealWorldTime, period: cut.period }, { ...sync, cuts: (sync.cuts ?? []).filter((c) => !same(c)) });
  return before === null ? null : cut.syncVideoTime - before;
}

/**
 * A fix made in the game view that can be taken back on its own: a cut
 * ("From this play on", the row's //) or a play's own place ("Only this
 * play"). A fix that moved a whole quarter changed that quarter's sync and
 * is not one of these: Details sets that again.
 */
export type SyncFix =
  | { kind: "cut"; period: number; realWorldTime: string; eventId: number | null; name: string; shift: number | null }
  | { kind: "own"; period: number; realWorldTime: string; eventId: number }
  /** Where the game's footage begins (SyncPoint.footageStart), with how many plays it leaves out of the video. */
  | { kind: "start"; seconds: number; plays: number };

/** The game's fixes, in game order. `name` is the stretch a cut starts ("Q2 from 6:14"). */
export function syncFixes(sync: SyncPoint, events: readonly CheckEvent[]): SyncFix[] {
  const parts = syncParts(sync, events);
  const out: SyncFix[] = [];
  // Where the game's footage begins comes first: it is the start of the video.
  const start = sync.footageStart;
  const head: SyncFix[] = [];
  if (start !== undefined) {
    const plays = events.filter((e) => {
      const t = computeVideoTime(e, sync);
      return t !== null && t >= 0 && t < start;
    }).length;
    head.push({ kind: "start", seconds: start, plays });
  }
  for (const cut of sync.cuts ?? []) {
    const part = parts.find((p) => p.cut === cut);
    out.push({
      kind: "cut",
      period: cut.period,
      realWorldTime: cut.syncRealWorldTime,
      eventId: cut.eventId ?? null,
      name: part?.name ?? periodLabel(cut.period),
      shift: cutShiftSeconds(sync, cut),
    });
  }
  const byId = new Map(events.map((e) => [e.eventId, e]));
  for (const id of Object.keys(sync.playTimes ?? {})) {
    const e = byId.get(Number(id));
    if (e) out.push({ kind: "own", period: e.period, realWorldTime: e.realWorldTime, eventId: e.eventId });
  }
  const placed = out as Exclude<SyncFix, { kind: "start" }>[];
  return [...head, ...placed.sort((a, b) => a.period - b.period || msOf(a.realWorldTime) - msOf(b.realWorldTime))];
}

/** The sync without one fix: a cut's plays follow the sync before it again, an own-placed play follows the sync. */
export function withoutFix(sync: SyncPoint, fix: SyncFix): SyncPoint {
  if (fix.kind === "start") {
    const next = { ...sync };
    delete next.footageStart;
    return next;
  }
  return fix.kind === "cut" ? clearSyncCut(sync, fix.realWorldTime) : withoutOwnTime(sync, { eventId: fix.eventId });
}

/** The sync without any of the game view's fixes: each quarter is placed by its own sync alone. */
export function withoutFixes(sync: SyncPoint): SyncPoint {
  const next: SyncPoint = { ...sync };
  delete next.cuts;
  delete next.playTimes;
  delete next.footageStart;
  return next;
}

/**
 * Whether a play can be the one a coach is asked about: a made basket from
 * the field (the scoreboard changes, and the ball going in is one frame), with
 * a time, not logged late, and placed by the sync.
 */
export function isCheckable(event: CheckEvent, sync: SyncPoint): boolean {
  return (
    (event.type === "2pt" || event.type === "3pt") &&
    event.isSuccessful === 1 &&
    Number.isFinite(msOf(event.realWorldTime)) &&
    !event.loggedAt &&
    ownVideoTime(event, sync) === null
  );
}

/**
 * A play that will do when no made basket is left between two plays: a
 * missed shot, a turnover or a foul can be told in the footage too, only not
 * to the frame. Narrowing ends on these, so the plays between the last basket
 * before a jump and the first one after it land on the right side of it.
 */
function isTellable(event: CheckEvent, sync: SyncPoint): boolean {
  return (
    (event.type === "2pt" || event.type === "3pt" || event.type === "turnover" || event.type === "foul") &&
    Number.isFinite(msOf(event.realWorldTime)) &&
    !event.loggedAt &&
    ownVideoTime(event, sync) === null
  );
}

/** The checkable plays of a part, in time order. */
function checkable<E extends CheckEvent>(part: SyncPart, parts: readonly SyncPart[], events: readonly E[], sync: SyncPoint): E[] {
  return events
    .filter((e) => isCheckable(e, sync) && partOf(parts, e) === part)
    .sort((a, b) => msOf(a.realWorldTime) - msOf(b.realWorldTime) || a.eventId - b.eventId);
}

/**
 * The play to check a part with: its last made basket. The sync is set at a
 * stretch's start, so a play near its end is the one that tells whether the
 * whole stretch is right. `tried` are plays the coach passed on.
 */
export function checkCandidate<E extends CheckEvent>(
  part: SyncPart,
  parts: readonly SyncPart[],
  events: readonly E[],
  sync: SyncPoint,
  tried: ReadonlySet<number> = new Set(),
): E | null {
  return checkable(part, parts, events, sync).filter((e) => !tried.has(e.eventId)).at(-1) ?? null;
}

/** While narrowing, a play found this near to where the shift would put it has the same shift. */
export const SAME_SHIFT_SECONDS = 1.5;

/**
 * A stretch in doubt while a shift is narrowed down. `b` is the play the
 * later sync starts at (a cut made from it, `SyncCut.eventId`), `a` the last
 * earlier play known to be in the right place (null when none is). The shift
 * starts somewhere after `a` and no later than `b`.
 */
export interface NarrowGap<E extends CheckEvent = CheckEvent> {
  a: E | null;
  b: E;
}

/** The cut made from a play ("From this play on"), if the sync has one. */
function cutFrom(sync: SyncPoint, play: { eventId: number }): SyncCut | null {
  return sync.cuts?.find((c) => c.eventId === play.eventId) ?? null;
}

/** How far the cut made from `b` moves the plays after it, against the sync before it; 0 when there is no such cut. */
export function gapShift(sync: SyncPoint, b: CheckEvent): number {
  const cut = cutFrom(sync, b);
  if (!cut) return 0;
  const moment = { realWorldTime: b.realWorldTime, period: b.period };
  const now = computeVideoTime(moment, sync);
  const without = computeVideoTime(moment, clearSyncCut(sync, cut.syncRealWorldTime));
  return now !== null && without !== null ? now - without : 0;
}

/**
 * The next play to look at in a gap: of the made baskets after `a` and
 * before the cut at `b`, the first when no play is known to be right (off
 * there too: the whole stretch is), else the middle one. With no basket left
 * between a play seen right and the cut, the middle one of the other plays
 * that can be told (isTellable). Null when none is left in doubt, or the cut
 * is gone.
 */
export function gapCandidate<E extends CheckEvent>(sync: SyncPoint, events: readonly E[], gap: NarrowGap): E | null {
  const cut = cutFrom(sync, gap.b);
  if (!cut) return null;
  const upper = msOf(cut.syncRealWorldTime);
  // The stretch the gap is in starts at the cut before this one in the quarter, or with the quarter.
  const before = (sync.cuts ?? []).filter((c) => c.period === gap.b.period && msOf(c.syncRealWorldTime) < upper).at(-1);
  const lower = Math.max(gap.a ? msOf(gap.a.realWorldTime) : -Infinity, before ? msOf(before.syncRealWorldTime) : -Infinity);
  const between = (will: (e: E) => boolean) =>
    events
      .filter((e) => {
        if (!will(e) || e.period !== gap.b.period || e.eventId === gap.a?.eventId || e.eventId === gap.b.eventId) return false;
        const at = msOf(e.realWorldTime);
        return at < upper && (gap.a ? at > lower : at >= lower);
      })
      .sort((x, y) => msOf(x.realWorldTime) - msOf(y.realWorldTime) || x.eventId - y.eventId);
  const baskets = between((e) => isCheckable(e, sync));
  if (baskets.length > 0) return gap.a === null ? baskets[0] : baskets[Math.floor(baskets.length / 2)];
  // Between two baskets next to each other: the other plays a coach can tell, down to the one the shift starts at.
  if (gap.a === null) return null;
  const others = between((e) => isTellable(e, sync));
  return others.length > 0 ? others[Math.floor(others.length / 2)] : null;
}

/** A cut made from `event` starts `leadSeconds` before it, but never so early that it takes the last play seen right with it. */
function leadAfter(lastRight: CheckEvent | null, event: CheckEvent, leadSeconds: number): number {
  if (!lastRight) return leadSeconds;
  const room = (msOf(event.realWorldTime) - msOf(lastRight.realWorldTime)) / 1000;
  return Math.max(0, Math.min(leadSeconds, room / 2));
}

/** The play looked right: the shift starts after it. */
export function narrowRight<E extends CheckEvent>(sync: SyncPoint, gap: NarrowGap<E>, event: E): { sync: SyncPoint; gaps: NarrowGap<E>[] } {
  return { sync: withCheck(sync, event), gaps: [{ a: event, b: gap.b }] };
}

/**
 * The play was off, and the coach found it at `found`. Where the gap's shift
 * would put it (within SAME_SHIFT_SECONDS): the shift reaches back to this
 * play, and the cut moves to it. Where the sync already had it: it was right
 * after all. Anywhere else: the play has an error of its own, and is fixed
 * on its own (from the start of the stretch when nothing before it is known
 * to be right, else from the play), which leaves a gap on either side of it.
 */
export function narrowFound<E extends CheckEvent>(
  sync: SyncPoint,
  events: readonly E[],
  gap: NarrowGap<E>,
  event: E,
  found: number,
  leadSeconds: number,
): { sync: SyncPoint; gaps: NarrowGap<E>[]; outcome: "same" | "right" | "own" } {
  const mapped = computeVideoTime(event, sync);
  const cut = cutFrom(sync, gap.b);
  if (mapped === null || !cut) return { sync, gaps: [], outcome: "right" };
  const shift = gapShift(sync, gap.b);
  if (Math.abs(found - (mapped + shift)) < SAME_SHIFT_SECONDS) {
    // The same cut, starting at this play instead: every play after it stays exactly where it is.
    const without = clearSyncCut(sync, cut.syncRealWorldTime);
    const next = syncFromPlayOn(
      without,
      { realWorldTime: event.realWorldTime, period: event.period, eventId: event.eventId },
      (computeVideoTime(event, without) ?? mapped) + shift,
      leadAfter(gap.a, event, leadSeconds),
    );
    return { sync: next, gaps: [{ a: gap.a, b: event }], outcome: "same" };
  }
  if (Math.abs(found - mapped) < SAME_PLACE_SECONDS) return { ...narrowRight(sync, gap, event), outcome: "right" };
  if (gap.a === null) {
    // Nothing before it is known to be right, and it is the stretch's first basket: the stretch starts off by this much.
    const plan = planFix(sync, events, event, found, leadSeconds, "start");
    return plan ? { sync: plan.next, gaps: [{ a: event, b: gap.b }], outcome: "own" } : { sync, gaps: [], outcome: "own" };
  }
  const plan = planFix(sync, events, event, found, leadAfter(gap.a, event, leadSeconds), "play");
  if (!plan) return { sync, gaps: [], outcome: "own" };
  return { sync: plan.next, gaps: [{ a: gap.a, b: event }, { a: event, b: gap.b }], outcome: "own" };
}

/**
 * No play is left in doubt in the gap. With a play known to be right before
 * it, the cut is where the shift starts and nothing changes. With none (even
 * the stretch's first basket has the shift), the whole stretch was off: the
 * cut goes, and the stretch moves from its start.
 */
export function narrowClose(sync: SyncPoint, events: readonly CheckEvent[], gap: NarrowGap): SyncPoint {
  const cut = cutFrom(sync, gap.b);
  if (gap.a !== null || !cut) return sync;
  const shift = gapShift(sync, gap.b);
  const without = clearSyncCut(sync, cut.syncRealWorldTime);
  const next = shiftStretch(without, [...events], { realWorldTime: gap.b.realWorldTime, period: gap.b.period }, shift);
  // The found play is where it was; its check is written again for the sync that now places it.
  return standingChecks(sync).some((c) => c.eventId === gap.b.eventId) ? withCheck(next, gap.b) : next;
}

/** How many plays two syncs place differently. */
export function playsMoved(before: SyncPoint, after: SyncPoint, events: readonly CheckEvent[]): number {
  return events.filter((e) => moved(computeVideoTime(e, before), computeVideoTime(e, after))).length;
}

/**
 * The sync with `event` checked where the sync has it now (once, in time
 * order). Checks that no longer hold are dropped as it goes. A play the sync
 * can't place is not checked.
 */
export function withCheck(sync: SyncPoint, event: { eventId: number; period: number; realWorldTime: string }): SyncPoint {
  const videoTime = computeVideoTime(event, sync);
  const others = standingChecks(sync).filter((c) => c.eventId !== event.eventId);
  if (videoTime === null) return filterChecks(sync, (c) => others.includes(c));
  const checks = [...others, { period: event.period, eventId: event.eventId, realWorldTime: event.realWorldTime, videoTime }].sort(
    (a, b) => msOf(a.realWorldTime) - msOf(b.realWorldTime),
  );
  return { ...sync, checks };
}

/** The sync with only the checks `keep` says to keep. */
function filterChecks(sync: SyncPoint, keep: (check: SyncCheck) => boolean): SyncPoint {
  const checks = (sync.checks ?? []).filter(keep);
  const next: SyncPoint = { ...sync };
  if (checks.length > 0) next.checks = checks;
  else delete next.checks;
  return next;
}

/** "Only this play": the play is at `found` in the video, whatever the sync says. Nothing else moves. */
export function withOwnTime(sync: SyncPoint, event: { eventId: number }, found: number): SyncPoint {
  return { ...sync, playTimes: { ...(sync.playTimes ?? {}), [String(event.eventId)]: found } };
}

/** The sync without a play's own place: the play follows the sync again. */
export function withoutOwnTime(sync: SyncPoint, event: { eventId: number }): SyncPoint {
  if (sync.playTimes?.[String(event.eventId)] === undefined) return sync;
  const { [String(event.eventId)]: _gone, ...rest } = sync.playTimes;
  const next: SyncPoint = { ...sync, playTimes: rest };
  if (Object.keys(rest).length === 0) delete next.playTimes;
  return next;
}

/** Which the app proposes once a play is found: the play alone, or the play and what follows it. */
export function suggestedScope(event: { loggedAt?: string | null }, deltaSeconds: number): "play" | "on" {
  return event.loggedAt || Math.abs(deltaSeconds) < SMALL_FIX_SECONDS ? "play" : "on";
}

/** How far a fix reaches, for the words that say so. */
export interface FixReach {
  /** How many plays move. */
  plays: number;
  /** Where the move starts: with a quarter (the game's first: "the start"), or at a play inside one. */
  from: { kind: "period"; period: number } | { kind: "play" };
  /** Where it stops: the end of the game, the end of a quarter, a play the coach checked, or an earlier fix. */
  to: { kind: "game" } | { kind: "period"; period: number } | { kind: "check" } | { kind: "fix" };
}

export interface FixPlan {
  next: SyncPoint;
  /** How far the play moved, in seconds (later is positive). */
  delta: number;
  reach: FixReach;
}

/**
 * The fix for a play found at `found` seconds in the video, moving the plays
 * with it. `from` is where the move starts: "play" cuts the video at the play
 * (the plays before it stay), "start" moves the stretch the play is in from
 * its start (lib/period-sync.ts, shiftStretch). Either way the move stops at
 * the next checked play, which is held where it is with everything after it,
 * and at the next quarter or cut that is placed on its own. The play becomes
 * a check; a check the move reaches from behind is no longer one. Null when
 * the sync can't place the play.
 */
export function planFix<E extends CheckEvent>(
  sync: SyncPoint,
  events: readonly E[],
  event: E,
  found: number,
  leadSeconds: number,
  from: "play" | "start",
): FixPlan | null {
  if (!event.realWorldTime) return null;
  // A play with a place of its own gives it up: it is placed with the plays around it again.
  const base = withoutOwnTime(sync, event);
  const mapped = computeVideoTime(event, base);
  if (mapped === null) return null;
  const delta = found - mapped;
  const at = msOf(event.realWorldTime);
  const list: CheckEvent[] = [...events];
  let next =
    from === "play"
      ? syncFromPlayOn(base, { realWorldTime: event.realWorldTime, period: event.period, eventId: event.eventId }, found, leadSeconds)
      : shiftStretch(base, list, { realWorldTime: event.realWorldTime, period: event.period }, delta);

  // The first checked play after this one that the move reached: it was seen right where it was, so it is held
  // there, and with it everything that follows it.
  const byId = new Map(events.map((e) => [e.eventId, e]));
  const reached = (check: SyncCheck) => {
    const play = byId.get(check.eventId);
    return !!play && moved(computeVideoTime(play, base), computeVideoTime(play, next));
  };
  const held = standingChecks(base)
    .sort((a, b) => msOf(a.realWorldTime) - msOf(b.realWorldTime))
    .find((c) => c.eventId !== event.eventId && msOf(c.realWorldTime) > at && reached(c));
  if (held) {
    const play = byId.get(held.eventId)!;
    next = syncFromPlayOn(next, { realWorldTime: play.realWorldTime, period: play.period, eventId: play.eventId }, computeVideoTime(play, base)!, leadSeconds);
  }
  // A check behind the play that moved all the same (the whole stretch was off) is no longer knowledge.
  next = filterChecks(next, (c) => c.eventId === event.eventId || !reached(c));
  next = withCheck(next, { eventId: event.eventId, period: event.period, realWorldTime: event.realWorldTime });

  return { next, delta, reach: fixReach(base, next, events, standingChecks(sync)) };
}

/** What moved between two syncs, in the words' terms. */
function fixReach(before: SyncPoint, after: SyncPoint, events: readonly CheckEvent[], checks: readonly SyncCheck[]): FixReach {
  const order = events
    .filter((e) => Number.isFinite(msOf(e.realWorldTime)))
    .sort((a, b) => a.period - b.period || msOf(a.realWorldTime) - msOf(b.realWorldTime) || a.eventId - b.eventId);
  const changed = order.map((e) => moved(computeVideoTime(e, before), computeVideoTime(e, after)));
  const first = changed.indexOf(true);
  const last = changed.lastIndexOf(true);
  if (first < 0) return { plays: 0, from: { kind: "play" }, to: { kind: "fix" } };
  const prev = order[first - 1];
  const next = order[last + 1];
  const checked = new Set(checks.map((c) => c.eventId));
  return {
    plays: changed.filter(Boolean).length,
    from: !prev || prev.period < order[first].period ? { kind: "period", period: order[first].period } : { kind: "play" },
    to: !next
      ? { kind: "game" }
      : next.period > order[last].period
        ? { kind: "period", period: order[last].period }
        : checked.has(next.eventId)
          ? { kind: "check" }
          : { kind: "fix" },
  };
}

/** A fix's reach in words: "from this play to the end of Q2", "all of Q3", "the whole game". */
export function describeReach(reach: FixReach, firstPeriod = 1): string {
  const end =
    reach.to.kind === "game"
      ? "to the end of the game"
      : reach.to.kind === "period"
        ? `to the end of ${periodLabel(reach.to.period)}`
        : reach.to.kind === "check"
          ? "up to the next play you checked"
          : "up to the next fix";
  if (reach.from.kind === "play") return `from this play ${end}`;
  if (reach.to.kind === "game" && reach.from.period === firstPeriod) return "the whole game";
  if (reach.to.kind === "period" && reach.to.period === reach.from.period) return `all of ${periodLabel(reach.from.period)}`;
  return `from the start of ${periodLabel(reach.from.period)} ${end}`;
}

/** "22 s earlier", "1.5 s later", "2:05 later". */
export function describeShiftSeconds(deltaSeconds: number): string {
  const a = Math.abs(deltaSeconds);
  const amount =
    a < 10 ? `${Math.round(a * 10) / 10} s` : a < 60 ? `${Math.round(a)} s` : `${Math.floor(Math.round(a) / 60)}:${String(Math.round(a) % 60).padStart(2, "0")}`;
  return `${amount} ${deltaSeconds < 0 ? "earlier" : "later"}`;
}

/** A play in words a coach can find in the footage, and what it does to the score when it scores. */
export interface PlayCue {
  /** "#7 Anna Stoltz (KFU) scores a layup.", the team's code only when the feed has one. */
  sentence: string;
  /** The score before and after, home first, when the play changes it. */
  score: { before: { home: number; away: number }; after: { home: number; away: number } } | null;
}

function cueVerb(e: Pick<PlayByPlayEvent, "type" | "subType" | "isSuccessful">): string {
  const made = e.isSuccessful === 1;
  const sub = e.subType?.toLowerCase() ?? "";
  switch (e.type) {
    case "2pt":
      if (!made) return "misses a two";
      return sub.includes("dunk") ? "dunks" : sub.includes("layup") ? "scores a layup" : "scores a two";
    case "3pt":
      return made ? "makes a three" : "misses a three";
    case "freethrow":
      return made ? "makes a free throw" : "misses a free throw";
    case "rebound":
      return sub.includes("off") ? "grabs the offensive rebound" : "grabs the rebound";
    case "turnover":
      return "turns the ball over";
    case "steal":
      return "steals the ball";
    case "foul":
      return "commits a foul";
    case "foulon":
      return "is fouled";
    case "block":
      return "blocks the shot";
    case "assist":
      return "gets the assist";
    default:
      return e.type;
  }
}

/** The words for a play being checked or found, with its score change (`before` and `after` from the game's flow). */
export function playCue(
  e: Pick<PlayByPlayEvent, "type" | "subType" | "isSuccessful" | "player" | "eventTeam">,
  before: { home: number; away: number } | null,
  after: { home: number; away: number } | null,
): PlayCue {
  // A player is named with the team's code when the feed has one; a play with no player on it, by its team.
  const code = e.eventTeam?.teamCode?.trim() || "";
  const name = e.player ? `${e.player.firstName} ${e.player.familyName}`.trim() : "";
  const who = name ? `${e.player?.pno ? `#${e.player.pno} ` : ""}${name}${code ? ` (${code})` : ""}` : e.eventTeam?.teamName?.trim() || code || "The team";
  const changed = !!before && !!after && (before.home !== after.home || before.away !== after.away);
  return { sentence: `${who} ${cueVerb(e)}.`, score: changed ? { before: before!, after: after! } : null };
}
