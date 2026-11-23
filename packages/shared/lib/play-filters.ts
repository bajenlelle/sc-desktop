/**
 * One set of filters for every list of plays on the desktop: the game view, a
 * team's Plays, Add clips and the playlist editor. The Add clips vocabulary
 * (ClipFilters: event types, shot types, situations, teams, players, labels)
 * plus the quarters and the moment a coach asks a game about. Players are
 * playerKey()s everywhere, so a player is the same across games.
 *
 * Within a group the chosen values are alternatives; across groups every
 * chosen group must agree. Pure.
 */
import type { GameMarks } from "../types/game-marks";
import type { PlayByPlayEvent } from "../types/match";
import {
  EMPTY_CLIP_FILTERS,
  EVENT_TYPE_OPTIONS,
  SHOT_TYPE_OPTIONS,
  SITUATION_OPTIONS,
  matchesClipFiltersByKey,
  matchesLabelFilter,
  type ClipFilters,
} from "./clip-filters";
import { periodLabel } from "./events";
import { gameFlow, gameMoments, type GameMoment } from "./game-flow";

export interface PlayFilters extends ClipFilters {
  /** Global periods (5 = the first overtime); empty = every period. */
  periods: ReadonlySet<number>;
  /** One moment at a time. */
  moment: GameMoment | null;
}

export const EMPTY_PLAY_FILTERS: PlayFilters = { ...EMPTY_CLIP_FILTERS, periods: new Set(), moment: null };

/** A filter's place in the bar: the order its token takes and its popover section. */
export type PlayFilterField = "types" | "players" | "shotTypes" | "situations" | "periods" | "moment" | "teams" | "labels";

export const PLAY_FILTER_FIELDS: readonly PlayFilterField[] = ["types", "players", "shotTypes", "situations", "periods", "moment", "teams", "labels"];

/** What a field is called on its token and its section. */
export const PLAY_FILTER_NAMES: Readonly<Record<PlayFilterField, string>> = {
  types: "Event",
  players: "Player",
  shotTypes: "Shot type",
  situations: "Situation",
  periods: "Quarter",
  moment: "When",
  teams: "Team",
  labels: "Label",
};

/**
 * The moments, in the order a coach asks for them, with what each one is. "Fast break" is a Situation (the
 * feed's own qualifier, the same plays), so it isn't offered twice.
 */
export const MOMENT_OPTIONS: readonly { value: GameMoment; label: string; help: string }[] = [
  { value: "after_timeout", label: "After timeouts", help: "The play each team timeout led to" },
  { value: "quarter_start", label: "Quarter starts", help: "The first two minutes of every quarter" },
  { value: "quarter_end", label: "Quarter ends", help: "The last two minutes of every quarter" },
  { value: "clutch", label: "Clutch", help: "The last five minutes of the fourth quarter or overtime, within five points" },
  { value: "run", label: "Runs", help: "Every play inside a run of eight unanswered points or more" },
];

/** Whether a field narrows the list. */
export function fieldOn(f: PlayFilters, field: PlayFilterField): boolean {
  if (field === "moment") return f.moment !== null;
  if (field === "labels") return (f.labels?.size ?? 0) > 0;
  return f[field].size > 0;
}

/** How many fields narrow the list (the count on the Filter button). */
export function playFiltersCount(f: PlayFilters): number {
  return PLAY_FILTER_FIELDS.filter((field) => fieldOn(f, field)).length;
}

export function playFiltersActive(f: PlayFilters): boolean {
  return playFiltersCount(f) > 0;
}

/** The filters with one field emptied. */
export function clearField(f: PlayFilters, field: PlayFilterField): PlayFilters {
  if (field === "moment") return { ...f, moment: null };
  return { ...f, [field]: new Set() };
}

/** A copy of the set with `value` in it, or out of it when it was. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Whether a play passes: the Add clips groups (players by key), its quarter, its moment (`moments`, the
 * moments of this play; a moment needs them) and its labels (`labels`, the labels on this play).
 */
export function matchesPlay(
  f: PlayFilters,
  e: PlayByPlayEvent,
  labels?: ReadonlySet<string>,
  moments?: ReadonlySet<GameMoment>,
): boolean {
  if (f.periods.size > 0 && !f.periods.has(e.period)) return false;
  if (f.moment && !moments?.has(f.moment)) return false;
  if (!matchesClipFiltersByKey(e, f)) return false;
  return matchesLabelFilter(labels, f.labels);
}

/** The entries that pass, in their order. */
export function applyPlayFilters<T extends { event: PlayByPlayEvent }>(
  entries: readonly T[],
  f: PlayFilters,
  labelsOf?: (entry: T) => ReadonlySet<string> | undefined,
  momentsOf?: (entry: T) => ReadonlySet<GameMoment> | undefined,
): T[] {
  if (!playFiltersActive(f)) return [...entries];
  return entries.filter((x) => matchesPlay(f, x.event, labelsOf?.(x), momentsOf?.(x)));
}

/** A filter that is on, as its token reads: "Player is #13 Larsson", "Event is any of 2PT made, 3PT miss". */
export interface AppliedFilter {
  field: PlayFilterField;
  name: string;
  op: "is" | "is any of";
  /** The chosen values, in words, in the order the section lists them. */
  values: string[];
}

/** The words for values that aren't fixed: a player's, a label's. */
export interface FilterWords {
  player?: (key: string) => string;
  label?: (id: string) => string;
}

const OPTION_LABELS: Partial<Record<PlayFilterField, ReadonlyMap<string, string>>> = {
  types: new Map(EVENT_TYPE_OPTIONS.map((o) => [o.value, o.label])),
  shotTypes: new Map(SHOT_TYPE_OPTIONS.map((o) => [o.value, o.label])),
  situations: new Map(SITUATION_OPTIONS.map((o) => [o.value, o.label])),
};

/** A player's key in words when nothing better is known: the name a "name:" key carries, else the key. */
function keyWords(key: string): string {
  return key.startsWith("name:") ? key.slice(5) : key;
}

/** The filters that are on, one token per field, in the bar's order. */
export function appliedFilters(f: PlayFilters, words: FilterWords = {}): AppliedFilter[] {
  const out: AppliedFilter[] = [];
  for (const field of PLAY_FILTER_FIELDS) {
    if (!fieldOn(f, field)) continue;
    let values: string[];
    if (field === "moment") values = [MOMENT_OPTIONS.find((m) => m.value === f.moment)?.label ?? String(f.moment)];
    else if (field === "periods") values = [...f.periods].sort((a, b) => a - b).map(periodLabel);
    else if (field === "players") values = [...f.players].map((k) => words.player?.(k) ?? keyWords(k));
    else if (field === "labels") values = [...(f.labels ?? [])].map((id) => words.label?.(id) ?? id);
    else if (field === "teams") values = [...f.teams];
    else {
      const names = OPTION_LABELS[field]!;
      const chosen = f[field];
      // In the section's order, so a token reads as the chips do.
      values = [...names.keys()].filter((v) => chosen.has(v)).map((v) => names.get(v)!);
      for (const v of chosen) if (!names.has(v)) values.push(v);
    }
    out.push({ field, name: PLAY_FILTER_NAMES[field], op: values.length > 1 ? "is any of" : "is", values });
  }
  return out;
}

/**
 * Each game's moments, by eventId, from its plays and its marks (timeouts and period bounds, when the game
 * view has read them): what a moment filter reads outside the game view. A game without marks has no
 * "After timeouts".
 */
export function momentsOfGame(events: readonly PlayByPlayEvent[], marks?: GameMarks | null): Map<number, ReadonlySet<GameMoment>> {
  return gameMoments(gameFlow(events), marks ?? null);
}

/** The fields that are on, by the names analytics groups them under. */
export function activeGroups(f: PlayFilters): string[] {
  const names: Record<PlayFilterField, string> = {
    types: "types",
    players: "players",
    shotTypes: "shots",
    situations: "situations",
    periods: "quarters",
    moment: "moment",
    teams: "teams",
    labels: "labels",
  };
  return PLAY_FILTER_FIELDS.filter((field) => fieldOn(f, field)).map((field) => names[field]);
}
