/**
 * Per-quarter sync, for game videos that skip the breaks between quarters.
 * Each cut moves every later play, so a quarter can carry its own sync
 * (SyncPoint.periods); a quarter without one follows the nearest earlier
 * quarter that has one (see syncForPeriod in clip-timing.ts).
 */

import type { PeriodMark, PeriodSync, SyncPoint } from "../types/match";

const isTime = (s: unknown): s is string => typeof s === "string" && !Number.isNaN(new Date(s).getTime());
const isSeconds = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * A stored sync point with its per-period parts checked. Entries that can't
 * place a play (a bad time, or period "1", which is the top-level sync) are
 * dropped rather than trusted. The Q1 fields are left as they are.
 */
export function normalizeSyncPoint(raw: SyncPoint): SyncPoint {
  const out: SyncPoint = { ...raw };

  if ("periods" in raw) {
    const periods: Record<string, PeriodSync> = {};
    for (const [key, ps] of Object.entries(raw.periods ?? {})) {
      const p = Number(key);
      if (Number.isInteger(p) && p >= 2 && ps && isSeconds(ps.syncVideoTime) && isTime(ps.syncRealWorldTime)) {
        periods[String(p)] = ps;
      }
    }
    if (Object.keys(periods).length > 0) out.periods = periods;
    else delete out.periods;
  }

  if ("marks" in raw) {
    const marks: Record<string, PeriodMark> = {};
    for (const [key, m] of Object.entries(raw.marks ?? {})) {
      const p = Number(key);
      if (!Number.isInteger(p) || p < 1 || !m?.anchor || !isTime(m.anchor.realWorldTime)) continue;
      const mark: PeriodMark = { anchor: m.anchor };
      if (isTime(m.startRealWorldTime)) mark.startRealWorldTime = m.startRealWorldTime;
      if (isTime(m.endRealWorldTime)) mark.endRealWorldTime = m.endRealWorldTime;
      marks[String(p)] = mark;
    }
    if (Object.keys(marks).length > 0) out.marks = marks;
    else delete out.marks;
  }

  if ("breaksCut" in raw && typeof raw.breaksCut !== "boolean") delete out.breaksCut;
  return out;
}
