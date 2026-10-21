// Known upstream data errors in specific Genius matches, corrected on the way
// out of the proxy so every import (any app version) gets clean times. The
// cache keeps the raw feed; this runs on every response.
//
// Match 2904178 (Huddinge vs Kvarnby Lions, Basketettan Dam, 2026-10-11): the
// period/game actions carry the real server time (Q1 starts 11:01:17 on
// 2026-10-11) but every other action carries a scoring-tablet clock that is
// 13 d 17:52 ahead (it starts 2026-10-25 04:53:51). The offset is nearly
// constant over the game (17:52:00–17:52:34 per quarter), so one shift puts
// the events back; a quarter's plays can still sit up to ~30 s off.

type Json = Record<string, unknown>;

/** Genius match id → seconds the mis-stamped actions are ahead of the real time. */
const TABLET_CLOCK_AHEAD_SECONDS: Record<number, number> = {
  // 13 d 17:52:34 puts the first event 3 s after the real period start,
  // where the video shows it (tip-off found at 375.5 s, first basket at 6:19).
  2904178: 1_187_554,
};

/** Actions this far after the game's real period-1 start are the mis-stamped ones. */
const MISSTAMPED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const TIME_RE = /^(\d{4}-\d{2}-\d{2})([ T])(\d{2}:\d{2}:\d{2})(.*)$/;

function toMs(timeActual: unknown): number | null {
  if (typeof timeActual !== "string") return null;
  const m = timeActual.match(TIME_RE);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[3]}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Same shape as the input ("2026-10-25 04:53:51" stays space-separated). */
function shiftTime(timeActual: string, deltaSeconds: number): string {
  const m = timeActual.match(TIME_RE)!;
  const shifted = new Date(Date.parse(`${m[1]}T${m[3]}Z`) + deltaSeconds * 1000).toISOString();
  return `${shifted.slice(0, 10)}${m[2]}${shifted.slice(11, 19)}${m[4]}`;
}

/**
 * The match's actions with known time errors corrected. A copy, never the
 * input (the cache row and the first-fetch upsert keep the raw feed). Leaves
 * everything alone when the match has no known error, or when the feed has
 * since been fixed upstream (no action far from the real period-1 start).
 */
export function correctKnownFeedErrors(matchId: number, actions: Json[]): Json[] {
  const ahead = TABLET_CLOCK_AHEAD_SECONDS[matchId];
  if (!ahead) return actions;

  const start = actions.find((a) => a.actionType === "period" && a.subType === "start" && a.period === 1);
  const startMs = toMs(start?.timeActual);
  if (startMs === null) return actions;

  let touched = false;
  const out = actions.map((a) => {
    const ms = toMs(a.timeActual);
    if (ms === null || ms - startMs <= MISSTAMPED_AFTER_MS) return a;
    touched = true;
    return { ...a, timeActual: shiftTime(a.timeActual as string, -ahead) };
  });
  return touched ? out : actions;
}
