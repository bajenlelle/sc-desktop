/**
 * The import picker's decisions, pure so the desktop and the web make them
 * the same way: which league, season and stage are selected once a served
 * catalogue replaces the bundled one, which games a search shows, whether a
 * space opens on its own team's games, and what an empty list says.
 */
import type { League, Season, Stage } from "../types/league";
import type { ScheduleGame } from "./genius";

export type ImportView = "team" | "all";

/**
 * The selection re-resolved by id against a (new) league list: a served
 * catalogue replaces the bundled objects, and the selected season must
 * follow to the new object (and its competitionId), not keep the old one.
 * Falls back to the first league and its first season; null without leagues.
 */
export function resolveSelection(
  leagues: League[],
  current: { leagueId?: string | null; seasonId?: string | null },
): { league: League; season: Season | null } | null {
  if (leagues.length === 0) return null;
  const league = (current.leagueId && leagues.find((l) => l.id === current.leagueId)) || leagues[0];
  const season = (current.seasonId && league.seasons.find((s) => s.id === current.seasonId)) || league.seasons[0] || null;
  return { league, season };
}

/** The stage to keep across a catalogue refresh: the same id, else the first. */
export function resolveStage(stages: Stage[], currentId: string | null | undefined): Stage | null {
  return stages.find((s) => s.id === currentId) ?? stages[0] ?? null;
}

/** The games matching a search by team name (short or long) or date (as "2026-10-04"). */
export function filterScheduleGames(games: ScheduleGame[], query: string): ScheduleGame[] {
  const q = query.trim().toLowerCase();
  if (!q) return games;
  return games.filter(
    (g) =>
      g.homeTeamInfo.names.short.toLowerCase().includes(q) ||
      g.homeTeamInfo.names.long.toLowerCase().includes(q) ||
      g.awayTeamInfo.names.short.toLowerCase().includes(q) ||
      g.awayTeamInfo.names.long.toLowerCase().includes(q) ||
      new Date(g.rawStartDateTime).toLocaleDateString("sv-SE").includes(q),
  );
}

/**
 * Which games a space opens on: its own team's, unless it has no team or
 * chose "All games" before (only that choice is remembered).
 */
export function decideImportView(teamId: string | null | undefined, storedView: ImportView | null): ImportView {
  return teamId && storedView !== "all" ? "team" : "all";
}

/** The part of Storage the view memory uses. */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const importViewKey = (orgId: string) => `scoutable_import_view:${orgId}`;

/** The view a space last chose on this device; only "all" is stored. */
export function readImportView(storage: StorageLike | null | undefined, orgId: string | null): ImportView | null {
  if (!orgId || !storage) return null;
  try {
    return storage.getItem(importViewKey(orgId)) === "all" ? "all" : null;
  } catch {
    return null;
  }
}

export function writeImportView(storage: StorageLike | null | undefined, orgId: string | null, view: ImportView): void {
  if (!orgId || !storage) return;
  try {
    if (view === "all") storage.setItem(importViewKey(orgId), "all");
    else storage.removeItem(importViewKey(orgId));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

/**
 * What an empty "All games" list says. An empty schedule (early in a season,
 * before any game is COMPLETE, or a Profixio category nobody has played in)
 * reads differently from a search miss.
 */
export function scheduleEmptyMessage(opts: {
  scheduleCount: number;
  isProfixio: boolean;
  stage: Stage | null;
  stageCount: number;
  seasonCount: number;
  seasonLabel: string | null;
}): string {
  if (opts.scheduleCount === 0 && opts.isProfixio && opts.stage && opts.stageCount > 1) {
    return `No played games in ${opts.stage.label} yet. Pick another category above.`;
  }
  if (opts.scheduleCount === 0 && opts.seasonCount > 1) {
    return `No completed games in ${opts.seasonLabel ?? "this season"} yet. Switch season above to import earlier games.`;
  }
  return "No games found.";
}
