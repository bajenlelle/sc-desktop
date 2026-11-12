/**
 * A filter preset: clip filters a coach saved under a name (filter_presets,
 * 20261112110000) and applies again. This module is the single definition of
 * the stored shape (`filter_presets.filters`) and the conversions between it,
 * the Add clips picker's filters and the game view's. Pure; the reads and
 * writes are filter-presets-db.ts.
 *
 * Players are stored as playerKey()s ("id:<personId>", "name:<name>"), as the
 * Add clips picker holds them, so a preset finds the same player across games.
 */

import {
  EVENT_TYPE_OPTIONS,
  SHOT_TYPE_OPTIONS,
  SITUATION_OPTIONS,
  type ClipFilters,
} from "./clip-filters";
import { foldForSearch } from "./league-teams";

/** filter_presets.filters. Arrays sorted; players are playerKey()s ("id:<personId>" | "name:<name>"); labels are label ids of the preset's space; teams are team names. */
export interface FilterPresetData {
  v: 1;
  types: string[];
  shotTypes: string[];
  situations: string[];
  teams: string[];
  players: string[];
  labels: string[];
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: ClipFilters;
  createdAt: string;
}

const GROUPS = ["types", "shotTypes", "situations", "teams", "players", "labels"] as const;

const sorted = (values: ReadonlySet<string> | undefined): string[] => [...(values ?? [])].sort();

export function serialiseFilters(f: ClipFilters): FilterPresetData {
  return {
    v: 1,
    types: sorted(f.types),
    shotTypes: sorted(f.shotTypes),
    situations: sorted(f.situations),
    teams: sorted(f.teams),
    players: sorted(f.players),
    labels: sorted(f.labels),
  };
}

const TYPE_VALUES = new Set(EVENT_TYPE_OPTIONS.map((o) => o.value));
const SHOT_TYPE_VALUES = new Set(SHOT_TYPE_OPTIONS.map((o) => o.value));
const SITUATION_VALUES = new Set(SITUATION_OPTIONS.map((o) => o.value));
const PLAYER_KEY = /^(id:\d+|name:.+)$/;

/** The strings of `raw` that `keep` accepts; nothing when `raw` isn't an array. */
function strings(raw: unknown, keep: (s: string) => boolean): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x): x is string => typeof x === "string" && keep(x)));
}

/** Null for anything that isn't a v1 object; unknown values and keys dropped, missing groups empty. */
export function parsePresetFilters(raw: unknown): ClipFilters | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const nonEmpty = (s: string) => s !== "";
  return {
    types: strings(r.types, (s) => TYPE_VALUES.has(s)),
    shotTypes: strings(r.shotTypes, (s) => SHOT_TYPE_VALUES.has(s)),
    situations: strings(r.situations, (s) => SITUATION_VALUES.has(s)),
    teams: strings(r.teams, nonEmpty),
    players: strings(r.players, (s) => PLAYER_KEY.test(s)),
    labels: strings(r.labels, nonEmpty),
  };
}

function sameSet(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
  const x = a ?? new Set<string>();
  const y = b ?? new Set<string>();
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
}

/** Whether two filters choose the same values, in any order; a missing label group counts as empty. */
export function sameFilters(a: ClipFilters, b: ClipFilters): boolean {
  return GROUPS.every((g) => sameSet(a[g], b[g]));
}

/**
 * A preset for the games on screen: teams, players and labels they don't have are left out.
 * A team is matched by its folded name and kept as the games spell it.
 */
export function fitPresetToGames(
  p: ClipFilters,
  available: { teams: readonly string[]; players: readonly string[]; labels: readonly string[] },
): ClipFilters {
  const teamByFold = new Map(available.teams.map((t) => [foldForSearch(t), t]));
  const teams = new Set<string>();
  for (const t of p.teams) {
    const there = teamByFold.get(foldForSearch(t));
    if (there !== undefined) teams.add(there);
  }
  const players = new Set(available.players);
  const labels = new Set(available.labels);
  return {
    types: new Set(p.types),
    shotTypes: new Set(p.shotTypes),
    situations: new Set(p.situations),
    teams,
    players: new Set([...p.players].filter((k) => players.has(k))),
    labels: new Set([...(p.labels ?? [])].filter((l) => labels.has(l))),
  };
}

/** What presetToGame and gameToPreset need of one game: its teams, the people on its plays and its space's label ids. */
export interface PresetGame {
  home: string;
  away: string;
  people: readonly { id: number; name: string }[];
  labels: readonly string[];
}

/**
 * The game view's terms: players by name, one team as its Both/home/away control.
 * A player the game doesn't have is left out; `team` is 1 (home) or 2 (away)
 * when exactly one of the preset's teams is one of the game's, else 0 (both).
 * The game view filters teams with `team`, so `clip.teams` is empty.
 */
export function presetToGame(p: ClipFilters, g: PresetGame): { clip: ClipFilters; team: 0 | 1 | 2 } {
  const nameById = new Map(g.people.map((x) => [`id:${x.id}`, x.name]));
  const names = new Set(g.people.map((x) => x.name));
  const players = new Set<string>();
  for (const key of p.players) {
    if (key.startsWith("id:")) {
      const name = nameById.get(key);
      if (name !== undefined) players.add(name);
    } else if (key.startsWith("name:")) {
      const name = key.slice("name:".length);
      if (names.has(name)) players.add(name);
    }
  }

  const home = foldForSearch(g.home);
  const away = foldForSearch(g.away);
  const sides = [...p.teams].map(foldForSearch).filter((t) => t === home || t === away);
  const team: 0 | 1 | 2 = sides.length === 1 ? (sides[0] === home ? 1 : 2) : 0;

  const labels = new Set(g.labels);
  return {
    clip: {
      types: new Set(p.types),
      shotTypes: new Set(p.shotTypes),
      situations: new Set(p.situations),
      teams: new Set(),
      players,
      labels: new Set([...(p.labels ?? [])].filter((l) => labels.has(l))),
    },
    team,
  };
}

/**
 * The game view's filters as a preset: a player as the playerKey() of the
 * person with that name ("name:<name>" when nobody on the game has it), the
 * Both/home/away control as the team's name. `clip.teams` is not read.
 */
export function gameToPreset(clip: ClipFilters, team: 0 | 1 | 2, g: PresetGame): ClipFilters {
  const idByName = new Map<string, number>();
  for (const x of g.people) if (!idByName.has(x.name)) idByName.set(x.name, x.id);
  const players = new Set<string>();
  for (const name of clip.players) {
    const id = idByName.get(name);
    players.add(id !== undefined ? `id:${id}` : `name:${name}`);
  }
  return {
    types: new Set(clip.types),
    shotTypes: new Set(clip.shotTypes),
    situations: new Set(clip.situations),
    teams: new Set(team === 1 ? [g.home] : team === 2 ? [g.away] : []),
    players,
    labels: new Set(clip.labels ?? []),
  };
}
