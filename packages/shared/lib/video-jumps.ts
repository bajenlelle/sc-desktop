/**
 * Jumps in a game recording (docs/game-view.md, "Jumps in the video"): where a
 * dropped stream was joined back on, play is lost, and every later play is
 * off by as much until something places them again. The desktop finds the
 * recording's hard cuts in the background (ffmpeg's scene score, shared by
 * the recording's fingerprint: video_cut_scans); which of them are jumps
 * inside the game is worked out here, against the game's sync.
 *
 * Measured on nine downloaded games (2026-11-25): a dropped stream is a cut
 * on its own; a production's graphics in a break come as a run of cuts a few
 * seconds apart. So a jump is a cut with no other cut near it (a burst a
 * second or two long counts as one cut), inside a
 * quarter's play by the sync (not in a break, before the tip-off or after the
 * final play).
 *
 * A jump the coach has fixed is a cut in the sync (`SyncCut.jump`): plays
 * from it on are placed by it, and the plays the sync before it puts after
 * the jump were in the lost stretch: they are not in the video.
 */
import type { PlayByPlayEvent, SyncCheck, SyncCut, SyncPoint } from "../types/match";
import { computeVideoTime } from "./clip-timing";
import { withCuts } from "./period-sync";

/** A cut this far from any other is on its own: a jump, not a production's run of cuts. */
export const JUMP_ALONE_S = 30;
/**
 * Cuts this close together are one change of picture: a stream joined back on
 * can flash through a frame or two before it settles (Älmhult Beasts P16 vs
 * Södertälje, 2026-11-25: three cuts a second apart at 1:10:13). A production's
 * graphics are 3 s apart or more.
 */
export const CUT_BURST_S = 2;
/** A fix or a check this near a jump answers it. */
const ANSWERED_NEAR_S = 30;
/**
 * The play asked about is a basket at least this long after the jump by the
 * old sync: the plays just after it may be in what the drop lost (20–35 s in
 * the replays measured), and a lost play can't be found.
 */
export const JUMP_ASK_AFTER_S = 45;

/**
 * The cuts with no other cut within JUMP_ALONE_S. A burst of cuts under
 * CUT_BURST_S apart counts as one, at its last cut, where the picture after
 * the drop starts.
 */
export function isolatedCuts(cuts: readonly number[]): number[] {
  const bursts: { from: number; to: number }[] = [];
  for (const t of [...cuts].sort((a, b) => a - b)) {
    const last = bursts[bursts.length - 1];
    if (last && t - last.to < CUT_BURST_S) last.to = t;
    else bursts.push({ from: t, to: t });
  }
  return bursts
    .filter((b, i) => (i === 0 || b.from - bursts[i - 1].to > JUMP_ALONE_S) && (i === bursts.length - 1 || bursts[i + 1].from - b.to > JUMP_ALONE_S))
    .map((b) => b.to);
}

type JumpEvent = Pick<PlayByPlayEvent, "eventId" | "period" | "realWorldTime" | "gameClockTime" | "type" | "isSuccessful">;

/** A jump inside the game: where it is, the quarter it is in, and the first play after it. */
export interface VideoJump<E extends JumpEvent = JumpEvent> {
  /** Seconds into the video. */
  at: number;
  period: number;
  /** The play to ask about: the first made basket JUMP_ASK_AFTER_S after the jump by the sync, else the first one after it. */
  firstPlay: E;
  /** The first play the sync puts at or after the jump, which names where it is ("Q1 6:58"). */
  after: E;
  /** A fix starts at the jump, or a play after it has been seen in the right place: nothing left to ask. */
  answered: boolean;
}

const msOf = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

/**
 * The recording's jumps inside the game, by the sync: each isolated cut that
 * falls between a quarter's first and last play, after where the game's
 * footage starts. One the sync already answers (a cut within half a minute,
 * a check on a play after it before the next jump) is `answered`.
 */
export function videoJumps<E extends JumpEvent>(cuts: readonly number[], sync: SyncPoint, events: readonly E[]): VideoJump<E>[] {
  const timed = events
    .map((e) => ({ e, t: computeVideoTime(e, sync) }))
    .filter((p): p is { e: E; t: number } => p.t !== null && Number.isFinite(p.t) && !lostInJump(p.e, sync));
  const spans = new Map<number, { from: number; to: number }>();
  for (const { e, t } of timed) {
    const s = spans.get(e.period);
    spans.set(e.period, s ? { from: Math.min(s.from, t), to: Math.max(s.to, t) } : { from: t, to: t });
  }
  const start = sync.footageStart ?? 0;
  const found: VideoJump<E>[] = [];
  for (const at of isolatedCuts(cuts)) {
    if (at <= start + 2) continue;
    const period = [...spans.entries()].find(([, s]) => at > s.from && at < s.to)?.[0];
    if (period === undefined) continue;
    const later = timed.filter((p) => p.e.period === period && p.t >= at).sort((a, b) => a.t - b.t);
    const baskets = later.filter((p) => (p.e.type === "2pt" || p.e.type === "3pt") && p.e.isSuccessful === 1);
    const after = baskets.find((p) => p.t >= at + JUMP_ASK_AFTER_S) ?? baskets[0] ?? later[0];
    if (!after) continue;
    found.push({ at, period, firstPlay: after.e, after: later[0].e, answered: false });
  }
  found.sort((a, b) => a.at - b.at);
  const checks: SyncCheck[] = sync.checks ?? [];
  return found.map((j, i) => {
    const next = found[i + 1]?.at ?? Infinity;
    const fixed = (sync.cuts ?? []).some((c) => Math.abs(c.syncVideoTime - j.at) <= ANSWERED_NEAR_S);
    const seen = checks.some((c) => {
      const t = computeVideoTime(c, sync);
      return t !== null && Math.abs(t - c.videoTime) <= 0.05 && t >= j.at && t < next && c.period === j.period;
    });
    return { ...j, answered: fixed || seen };
  });
}

/**
 * Whether a play was in the stretch a fixed jump lost: the sync before the
 * jump puts it at or after the jump, but it came before the jump's own sync
 * starts. Its footage is not in the recording.
 */
export function lostInJump(event: Pick<PlayByPlayEvent, "period" | "realWorldTime"> & { eventId?: number }, sync: SyncPoint): boolean {
  const jumps = (sync.cuts ?? []).filter((c) => c.jump && c.period === event.period);
  if (jumps.length === 0) return false;
  if (event.eventId != null && sync.playTimes?.[String(event.eventId)] !== undefined) return false;
  const at = msOf(event.realWorldTime);
  if (!Number.isFinite(at)) return false;
  const t = computeVideoTime(event, sync);
  if (t === null) return false;
  return jumps.some((j) => at < msOf(j.syncRealWorldTime) && t >= j.syncVideoTime);
}

/**
 * The fix for a jump: from the jump on, the video is placed by the play the
 * coach found after it (`event` at `foundS`), up to the next fix. The cut
 * starts at the jump itself (it is known to the frame, so nothing is narrowed
 * down), and is marked as one so the plays it lost are known.
 */
export function syncFromJump(
  sync: SyncPoint,
  jumpS: number,
  event: Pick<PlayByPlayEvent, "eventId" | "period" | "realWorldTime">,
  foundS: number,
): SyncPoint {
  const from = msOf(event.realWorldTime) - (foundS - jumpS) * 1000;
  const cut: SyncCut = {
    period: event.period,
    syncVideoTime: jumpS,
    syncRealWorldTime: new Date(Math.round(from)).toISOString(),
    eventId: event.eventId,
    jump: true,
  };
  // A fix already near the jump, or between it and the play, was a try at the same thing: this one replaces it.
  const others = (sync.cuts ?? []).filter((c) => {
    const t = msOf(c.syncRealWorldTime);
    return Math.abs(c.syncVideoTime - jumpS) > ANSWERED_NEAR_S && !(t >= from - 500 && t <= msOf(event.realWorldTime));
  });
  return withCuts(sync, [...others, cut]);
}

/** How many plays a sync leaves in lost stretches. */
export function lostPlays(events: readonly Pick<PlayByPlayEvent, "eventId" | "period" | "realWorldTime">[], sync: SyncPoint): number {
  return events.filter((e) => lostInJump(e, sync)).length;
}
