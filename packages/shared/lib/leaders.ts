/**
 * Per-player leader lists derived from play-by-play — the data behind the
 * clip browser's "Leaders" quick-filter. Computed client-side from the events
 * already in memory ON PURPOSE: the values are then guaranteed consistent
 * with the clips the filter will show ("27 pts" = exactly the made-shot
 * events you get when you select that player), it costs no Genius quota, and
 * it works for legacy/demo imports that have no stats endpoint.
 *
 * Data rules (see docs/play-by-play-data-inventory.md):
 * - Points don't exist in the data — derive: made 2pt = 2, 3pt = 3, FT = 1.
 * - `isSuccessful` is meaningful ONLY for the three shot types; every
 *   non-shot row carries 1, so it must never gate other metrics.
 * - Team-level rows (team rebounds/turnovers) have `player: null` and the
 *   `offensivedeadball` inbound marker is bookkeeping — both are skipped.
 */
import type { PlayByPlayEvent } from "../types/match";
import { isBookkeepingEvent, playerName } from "./events";

export type LeaderMetric =
  | "points"
  | "assists"
  | "rebounds"
  | "steals"
  | "blocks"
  | "turnovers";

export interface LeaderRow {
  /** Display name — the same string the Player filter keys on (playerName). */
  name: string;
  teamName: string;
  value: number;
}

/** Single source for the picker chips, row units, and empty-state copy. */
export const LEADER_METRICS: Array<{ id: LeaderMetric; label: string; unit: string }> = [
  { id: "points", label: "Points", unit: "pts" },
  { id: "assists", label: "Assists", unit: "ast" },
  { id: "rebounds", label: "Rebounds", unit: "reb" },
  { id: "steals", label: "Steals", unit: "stl" },
  { id: "blocks", label: "Blocks", unit: "blk" },
  { id: "turnovers", label: "Turnovers", unit: "TO" },
];

const SHOT_POINTS: Record<string, number> = { "2pt": 2, "3pt": 3, freethrow: 1 };

function metricValue(e: PlayByPlayEvent, metric: LeaderMetric): number {
  switch (metric) {
    case "points": {
      const pts = SHOT_POINTS[e.type];
      return pts !== undefined && e.isSuccessful === 1 ? pts : 0;
    }
    case "assists":
      return e.type === "assist" ? 1 : 0;
    case "rebounds":
      return e.type === "rebound" ? 1 : 0;
    case "steals":
      return e.type === "steal" ? 1 : 0;
    case "blocks":
      return e.type === "block" ? 1 : 0;
    case "turnovers":
      return e.type === "turnover" ? 1 : 0;
  }
}

/**
 * Ranked leader rows (value desc, name asc for stable ranks) for one metric.
 * Zero-value players are omitted — an empty array means nothing of that
 * metric has been recorded in the given events.
 */
export function computeLeaders(
  events: PlayByPlayEvent[],
  metric: LeaderMetric,
): LeaderRow[] {
  const tally = new Map<string, LeaderRow>();
  for (const e of events) {
    if (!e.player || isBookkeepingEvent(e)) continue;
    const value = metricValue(e, metric);
    if (value === 0) continue;
    const name = playerName(e);
    const row = tally.get(name);
    if (row) {
      row.value += value;
    } else {
      tally.set(name, { name, teamName: e.eventTeam?.teamName ?? "", value });
    }
  }
  return [...tally.values()].sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name, "sv"),
  );
}
