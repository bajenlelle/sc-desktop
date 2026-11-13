/**
 * A filter preset: clip filters a coach saved under a name (filter_presets,
 * 20261112110000) and applies again. This module is the single definition of
 * the stored shape (`filter_presets.filters`) and of what applying a preset
 * does to the filters on screen, in Add clips and the game view alike. Pure;
 * the reads and writes are filter-presets-db.ts.
 *
 * A preset holds plays (event types), shot types, situations and labels,
 * never teams or players: the point of one is to apply the same event filters
 * to different players and teams, so applying it leaves the chosen team and
 * players as they are. Labels are label ids of the preset's space; one the
 * space no longer has is left out when the preset is applied.
 */

import {
  EVENT_TYPE_OPTIONS,
  SHOT_TYPE_OPTIONS,
  SITUATION_OPTIONS,
  type ClipFilters,
} from "./clip-filters";

/**
 * filter_presets.filters. Arrays sorted; labels are label ids of the preset's
 * space. Rows written before presets dropped teams and players (2026-11-13)
 * may also carry `teams` and `players`; readers ignore them.
 */
export interface FilterPresetData {
  v: 1;
  types: string[];
  shotTypes: string[];
  situations: string[];
  labels: string[];
}

export interface FilterPreset {
  id: string;
  name: string;
  /** The preset's groups; `teams` and `players` are always empty. */
  filters: ClipFilters;
  createdAt: string;
}

/** The filter groups a preset holds. */
export const PRESET_GROUPS = ["types", "shotTypes", "situations", "labels"] as const;

const sorted = (values: ReadonlySet<string> | undefined): string[] => [...(values ?? [])].sort();

export function serialiseFilters(f: ClipFilters): FilterPresetData {
  return {
    v: 1,
    types: sorted(f.types),
    shotTypes: sorted(f.shotTypes),
    situations: sorted(f.situations),
    labels: sorted(f.labels),
  };
}

const TYPE_VALUES = new Set(EVENT_TYPE_OPTIONS.map((o) => o.value));
const SHOT_TYPE_VALUES = new Set(SHOT_TYPE_OPTIONS.map((o) => o.value));
const SITUATION_VALUES = new Set(SITUATION_OPTIONS.map((o) => o.value));

/** The strings of `raw` that `keep` accepts; nothing when `raw` isn't an array. */
function strings(raw: unknown, keep: (s: string) => boolean): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x): x is string => typeof x === "string" && keep(x)));
}

/** Null for anything that isn't a v1 object; unknown values and keys (teams and players among them) dropped, missing groups empty. */
export function parsePresetFilters(raw: unknown): ClipFilters | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  return {
    types: strings(r.types, (s) => TYPE_VALUES.has(s)),
    shotTypes: strings(r.shotTypes, (s) => SHOT_TYPE_VALUES.has(s)),
    situations: strings(r.situations, (s) => SITUATION_VALUES.has(s)),
    teams: new Set(),
    players: new Set(),
    labels: strings(r.labels, (s) => s !== ""),
  };
}

function sameSet(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
  const x = a ?? new Set<string>();
  const y = b ?? new Set<string>();
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
}

/** Whether two filters choose the same values in the preset groups, in any order; a missing label group counts as empty. Teams and players are not compared. */
export function sameFilters(a: ClipFilters, b: ClipFilters): boolean {
  return PRESET_GROUPS.every((g) => sameSet(a[g], b[g]));
}

/** The preset groups of the filters on screen, teams and players empty: what saving them keeps. */
export function presetFilters(f: ClipFilters): ClipFilters {
  return {
    types: new Set(f.types),
    shotTypes: new Set(f.shotTypes),
    situations: new Set(f.situations),
    teams: new Set(),
    players: new Set(),
    labels: new Set(f.labels ?? []),
  };
}

/**
 * The filters on screen with the preset applied: its plays, shot types,
 * situations and the labels of its that `labels` (the space's label ids) still
 * has; the team and players stay as they are.
 */
export function applyPresetFilters(current: ClipFilters, preset: ClipFilters, labels: readonly string[]): ClipFilters {
  const there = new Set(labels);
  return {
    ...current,
    types: new Set(preset.types),
    shotTypes: new Set(preset.shotTypes),
    situations: new Set(preset.situations),
    labels: new Set([...(preset.labels ?? [])].filter((l) => there.has(l))),
  };
}

/** Whether the preset names labels and `labels` has none of them: applied, it would quietly mean every label. */
export function presetLabelsGone(preset: ClipFilters, labels: readonly string[]): boolean {
  const wanted = preset.labels ?? new Set<string>();
  if (wanted.size === 0) return false;
  return !labels.some((l) => wanted.has(l));
}
