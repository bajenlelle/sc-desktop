/**
 * The add-clips picker's filters: the vocabulary the chips and menus offer
 * and the matchers that read a play-by-play event. Pure, shared by the
 * desktop's clip-browser-panel and the web editor's add-clips panel, so the
 * same filter means the same plays everywhere.
 *
 * Within one group the chosen values are alternatives (any of them lets an
 * event through); across groups every chosen group must agree.
 */
import type { PlayByPlayEvent } from "../types/match";
import { playerName } from "./events";

export interface FilterOption {
  value: string;
  label: string;
}

export const EVENT_TYPE_OPTIONS: readonly FilterOption[] = [
  { value: "2pt-made", label: "2PT made" },
  { value: "2pt-miss", label: "2PT miss" },
  { value: "3pt-made", label: "3PT made" },
  { value: "3pt-miss", label: "3PT miss" },
  { value: "freethrow-made", label: "FT made" },
  { value: "freethrow-miss", label: "FT miss" },
  { value: "rebound-off", label: "Off. rebound" },
  { value: "rebound-def", label: "Def. rebound" },
  { value: "turnover", label: "Turnover" },
  { value: "steal", label: "Steal" },
  { value: "assist", label: "Assist" },
  { value: "foul", label: "Foul" },
  { value: "foulon", label: "Foul drawn" },
  { value: "block", label: "Block" },
  { value: "timeout", label: "Timeout" },
];

export const SHOT_TYPE_OPTIONS: readonly FilterOption[] = [
  { value: "subtype:layup", label: "Layup" },
  { value: "subtype:floater", label: "Floater" },
  { value: "subtype:jumpshot", label: "Jump shot" },
  { value: "subtype:dunk", label: "Dunk / alley-oop" },
  { value: "subtype:tipin", label: "Tip-in" },
];

export const SITUATION_OPTIONS: readonly FilterOption[] = [
  { value: "qual:fastbreak", label: "Fast break" },
  { value: "qual:pointsinthepaint", label: "In the paint" },
  { value: "qual:2ndchance", label: "2nd chance" },
  { value: "qual:fromturnover", label: "From turnover" },
  { value: "qual:shooting", label: "Shooting foul" },
  { value: "subtype:charge", label: "Charge" },
  { value: "subtype:technical", label: "Technical foul" },
  { value: "subtype:badpass", label: "Bad pass" },
  { value: "subtype:ballhandling", label: "Ball handling" },
  { value: "subtype:travel", label: "Travel" },
  { value: "subtype:24sec", label: "Shot clock" },
];

/** One event-type chip: "2pt-made" is a made two, "rebound-def" a defensive rebound, "steal" any steal. */
export function matchesSingleType(e: PlayByPlayEvent, filter: string): boolean {
  if (filter === "rebound-off") return e.type === "rebound" && e.subType === "offensive";
  if (filter === "rebound-def") return e.type === "rebound" && e.subType === "defensive";
  if (filter === "rebound-inbound") return e.type === "rebound" && e.subType === "offensivedeadball";
  const [type, outcome] = filter.split("-");
  if (e.type !== type) return false;
  if (outcome === "made") return e.isSuccessful === 1;
  if (outcome === "miss") return e.isSuccessful === 0;
  return true;
}

export function matchesShotType(e: PlayByPlayEvent, f: string): boolean {
  const sub = e.subType ?? "";
  switch (f) {
    case "subtype:layup":
      return ["layup", "drivinglayup", "reverselayup"].includes(sub);
    case "subtype:floater":
      return sub === "floatingjumpshot";
    case "subtype:jumpshot":
      return ["jumpshot", "pullupjumpshot", "turnaroundjumpshot", "fadeaway", "stepbackjumpshot", "hookshot"].includes(sub);
    case "subtype:dunk":
      return ["dunk", "alleyoop", "alleyoopdunk"].includes(sub);
    case "subtype:tipin":
      return ["tipinlayup", "tipindunk"].includes(sub);
    default:
      return false;
  }
}

export function matchesSituation(e: PlayByPlayEvent, f: string): boolean {
  switch (f) {
    case "qual:fastbreak":
      return e.qualifiers.includes("fastbreak");
    case "qual:pointsinthepaint":
      return e.qualifiers.includes("pointsinthepaint");
    case "qual:2ndchance":
      return e.qualifiers.includes("2ndchance");
    case "qual:fromturnover":
      return e.qualifiers.includes("fromturnover");
    case "qual:shooting":
      return e.type === "foul" && e.qualifiers.includes("shooting");
    case "subtype:charge":
      return e.type === "foul" && e.subType === "offensive";
    case "subtype:technical":
      return e.type === "foul" && ["technical", "benchTechnical", "coachTechnical"].includes(e.subType ?? "");
    case "subtype:badpass":
      return e.type === "turnover" && e.subType === "badpass";
    case "subtype:ballhandling":
      return e.type === "turnover" && e.subType === "ballhandling";
    case "subtype:travel":
      return e.type === "turnover" && e.subType === "travel";
    case "subtype:24sec":
      return e.type === "turnover" && e.subType === "24sec";
    default:
      return false;
  }
}

/** The picker's chosen values per group; an empty group means "any". */
export interface ClipFilters {
  types: ReadonlySet<string>;
  shotTypes: ReadonlySet<string>;
  situations: ReadonlySet<string>;
  /** Team names as the feed writes them (eventTeam.teamName). */
  teams: ReadonlySet<string>;
  /** Player names as playerName() writes them. */
  players: ReadonlySet<string>;
  /**
   * Label ids (labels-db.ts). A label belongs to a clip, not to its event,
   * so applyClipFilters reads them through its `labelsOf`; the desktop's
   * picker filters labels on its own and leaves this out.
   */
  labels?: ReadonlySet<string>;
}

export const EMPTY_CLIP_FILTERS: ClipFilters = {
  types: new Set(),
  shotTypes: new Set(),
  situations: new Set(),
  teams: new Set(),
  players: new Set(),
  labels: new Set(),
};

export function hasActiveFilters(f: ClipFilters): boolean {
  return (
    f.types.size > 0 ||
    f.shotTypes.size > 0 ||
    f.situations.size > 0 ||
    f.teams.size > 0 ||
    f.players.size > 0 ||
    (f.labels?.size ?? 0) > 0
  );
}

function anyOf(values: ReadonlySet<string>, test: (v: string) => boolean): boolean {
  for (const v of values) if (test(v)) return true;
  return false;
}

/** Whether one event passes every chosen group (any value within a group). Labels are applyClipFilters'. */
export function matchesClipFilters(e: PlayByPlayEvent, f: ClipFilters): boolean {
  if (f.types.size > 0 && !anyOf(f.types, (v) => matchesSingleType(e, v))) return false;
  if (f.shotTypes.size > 0 && !anyOf(f.shotTypes, (v) => matchesShotType(e, v))) return false;
  if (f.situations.size > 0 && !anyOf(f.situations, (v) => matchesSituation(e, v))) return false;
  if (f.teams.size > 0 && !f.teams.has(e.eventTeam?.teamName ?? "")) return false;
  if (f.players.size > 0 && !f.players.has(playerName(e))) return false;
  return true;
}

/** Whether a clip's labels pass the label filter: any chosen label lets it through, and no filter lets everything through. */
export function matchesLabelFilter(assigned: ReadonlySet<string> | undefined, wanted: ReadonlySet<string> | undefined): boolean {
  if (!wanted || wanted.size === 0) return true;
  if (!assigned || assigned.size === 0) return false;
  return anyOf(wanted, (id) => assigned.has(id));
}

/**
 * The entries whose event passes the filters, in their given order. A label
 * filter reads each entry's labels through `labelsOf` (a clip nobody
 * labelled, or no `labelsOf`, has none).
 */
export function applyClipFilters<T extends { event: PlayByPlayEvent }>(
  entries: readonly T[],
  f: ClipFilters,
  labelsOf?: (entry: T) => ReadonlySet<string> | undefined,
): T[] {
  if (!hasActiveFilters(f)) return [...entries];
  return entries.filter((x) => matchesClipFilters(x.event, f) && matchesLabelFilter(labelsOf?.(x), f.labels));
}

/** The team names that appear in the events, in order of first appearance. */
export function teamsOf(events: readonly PlayByPlayEvent[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const name = e.eventTeam?.teamName;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** The player names that appear in the events (events with a player only), in order of first appearance. */
export function playersOf(events: readonly PlayByPlayEvent[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.player) continue;
    const name = playerName(e);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** A copy of the filters with `value` toggled in `group`. */
export function toggleFilter(f: ClipFilters, group: keyof ClipFilters, value: string): ClipFilters {
  const next = new Set(f[group] ?? []);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return { ...f, [group]: next };
}
