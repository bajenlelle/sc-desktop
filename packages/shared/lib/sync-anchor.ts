/**
 * Syncing a game whose tip-off isn't in the video (docs/game-view.md,
 * "When the tip-off isn't in the video"). A game is placed on the wall clock,
 * so any play seen in the footage places it as well as the tip-off does: the
 * first basket the coach can see is the easiest, since the ball goes in on
 * one frame and the score changes. The tip-off is then worked out from it,
 * and can lie before the recording starts (a negative sync).
 *
 * A recording can also hold the warm-up and then jump into the game, the
 * tip-off lost in a dropped stream: the plays before that jump have no
 * footage at all. `footageStart` (SyncPoint) is where the game's footage
 * begins; a play the sync puts before it is not in the video.
 */
import type { PlayByPlayEvent, SyncPoint } from "../types/match";
import { findLatePlays } from "./late-plays";

/** What the anchors read of a play. */
type AnchorEvent = Pick<PlayByPlayEvent, "eventId" | "period" | "type" | "isSuccessful" | "realWorldTime" | "gameClockTime" | "scoreHome" | "scoreAway">;

/** A made basket of the first quarter to sync on, and how long after the tip-off it came. */
export interface BasketAnchor<E extends AnchorEvent = AnchorEvent> {
  event: E;
  /** Seconds from the tip-off to the basket, on the wall clock. */
  afterTipoffS: number;
  /** The score once it went in, home first; null when the feed has none. */
  score: { home: number; away: number } | null;
}

const msOf = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

/**
 * The first quarter's made baskets from the field, in order, to sync on when
 * the tip-off can't be seen. A play the table logged late is left out: its
 * stamp is not when it happened (lib/late-plays.ts).
 */
export function q1Baskets<E extends AnchorEvent>(events: readonly E[], tipoffRealWorldTime: string): BasketAnchor<E>[] {
  const tip = msOf(tipoffRealWorldTime);
  if (!Number.isFinite(tip)) return [];
  const late = findLatePlays(events);
  return events
    .filter((e) => e.period === 1 && (e.type === "2pt" || e.type === "3pt") && e.isSuccessful === 1 && !late.has(e.eventId) && Number.isFinite(msOf(e.realWorldTime)))
    .map((event) => ({
      event,
      afterTipoffS: (msOf(event.realWorldTime) - tip) / 1000,
      score: event.scoreHome != null && event.scoreAway != null ? { home: event.scoreHome, away: event.scoreAway } : null,
    }))
    .filter((b) => b.afterTipoffS >= 0)
    .sort((a, b) => a.afterTipoffS - b.afterTipoffS || a.event.eventId - b.event.eventId);
}

/** The tip-off's place in the video from a basket's: as long before it as the feed says the basket came after. */
export function tipoffFromBasket(basketVideoS: number, anchor: Pick<BasketAnchor, "afterTipoffS">): number {
  return basketVideoS - anchor.afterTipoffS;
}

/**
 * How long after the tip-off the first points went on the board, by the
 * feed: what a scoreboard graphic with no clock can be lined up with. Free
 * throws count (the graphic shows them too); a play logged late does not.
 */
export function firstScoreAfterS(events: readonly AnchorEvent[], tipoffRealWorldTime: string): number | null {
  const tip = msOf(tipoffRealWorldTime);
  if (!Number.isFinite(tip)) return null;
  const late = findLatePlays(events);
  let best: number | null = null;
  for (const e of events) {
    if (e.period !== 1 || late.has(e.eventId) || e.scoreHome == null || e.scoreAway == null) continue;
    if (e.scoreHome + e.scoreAway <= 0) continue;
    const at = (msOf(e.realWorldTime) - tip) / 1000;
    if (!Number.isFinite(at) || at < 0) continue;
    if (best === null || at < best) best = at;
  }
  return best;
}

/** A hard cut this near the moment it is checked against is that moment. */
const CUT_NEAR_S = 2;

/**
 * Where the game's footage begins, from the hard cuts in the video (a
 * dropped stream joined back on): the last cut between where the tip-off
 * would be and the basket the coach found, when there is one. Before it the
 * recording shows something else (the warm-up), and the plays the sync puts
 * there are not in the video. Null when the footage runs unbroken to the
 * basket.
 */
export function footageStartFromCuts(cutsS: readonly number[], tipoffVideoS: number, basketVideoS: number): number | null {
  const from = Math.max(0, tipoffVideoS) + CUT_NEAR_S;
  const to = basketVideoS - CUT_NEAR_S;
  const inside = cutsS.filter((c) => c > from && c < to);
  return inside.length > 0 ? Math.max(...inside) : null;
}

/** Whether a found moment is a hard cut: the first frame after one shows play, not the tip-off. */
export function atCut(cutsS: readonly number[], seconds: number): boolean {
  return cutsS.some((c) => Math.abs(c - seconds) <= CUT_NEAR_S);
}

/** Whether a place in the video has the game's footage: not before the recording, or before where the game's footage begins. */
export function inFootage(videoTime: number, sync: Pick<SyncPoint, "footageStart">): boolean {
  return videoTime >= (sync.footageStart ?? 0);
}
