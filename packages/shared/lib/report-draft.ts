/**
 * The scouting report's draft: the document a coach writes next to a
 * playlist, kept per playlist in `scouting_report_drafts.content`
 * (migration 20261101100000). The playlist stays footage; the draft is the
 * write-up: a title and opponent, a team intro, one section per player (the
 * player, a note, their stats as a stats card snapshot), and where the
 * coach has moved clips by hand.
 *
 * Clip membership is DERIVED, never stored as a list: a clip goes to its
 * placement when the coach set one (`placements`, by clip item key), else to
 * the section whose player is in the play, else to the Team section. So a
 * clip added to the playlist later shows up under its player at once, and
 * the playlist's order is never changed by the report. A placement can also
 * leave a clip out of the report (LEFT_OUT) without touching the playlist.
 *
 * The report reads in its own order (`order`): empty until the coach first
 * moves a clip, then every clip in the report, in reading order. A clip it
 * doesn't name (added to the playlist since) follows the ones it does, in
 * playlist order.
 *
 * Pure: the desktop's view, the report builder (lib/scouting-report.ts) and
 * the tests share one definition. Every op returns a new draft, or the same
 * object when nothing changed.
 */
import type { PlayByPlayEvent, PlaylistClipItem, PlaylistItem } from "../types/match";
import { isClipItem } from "../types/match";
import { itemKey } from "./playlist-edits";
import { pushEdit, type Edit, type History } from "./playlist-history";
import { parseCardSpec, type StatsCardPlayer, type StatsCardSpec } from "./stats-card";

export const REPORT_DRAFT_VERSION = 1 as const;

/** What the note field lets a coach type. */
export const REPORT_NOTE_LIMIT = 600;
/** What is stored: room for an older, longer note without losing it. */
export const REPORT_NOTE_STORED_MAX = 2000;
export const REPORT_INTRO_LIMIT = 2000;
/** The table's cap on `content` (the publish function has the same for a report). */
export const REPORT_DRAFT_MAX_BYTES = 262144;
/** What the database accepts for a draft and a published report alike. */
export const REPORT_MAX_SECTIONS = 60;
export const REPORT_TITLE_MAX = 120;
/** The placement that means "the Team section". Never a section id. */
export const TEAM_SECTION = "team" as const;
/** The placement that keeps a clip out of the report (it stays in the playlist). Never a section id. */
export const LEFT_OUT = "out" as const;

export interface DraftSection {
  id: string;
  player: StatsCardPlayer;
  /** The coach's note; "" when there is none. */
  note: string;
  /** The player's numbers; null where the league has none or they could not be read. */
  stats: StatsCardSpec | null;
}

/** A section id, TEAM_SECTION, or (as a placement only) LEFT_OUT. */
export type Placement = string;

export interface ReportDraft {
  v: typeof REPORT_DRAFT_VERSION;
  /** Null: the playlist's name. */
  title: string | null;
  opponent: string | null;
  intro: string;
  /** Report order. */
  sections: DraftSection[];
  /** Where the coach moved a clip by hand, by clip item key (`<matchId>:<eventId>`). */
  placements: Record<string, Placement>;
  /**
   * The report's reading order, by clip item key; empty for playlist order.
   * Left-out clips are never in it. Added in 1.5.0: a draft without one reads
   * as empty, and 1.4.0 drops it when it saves.
   */
  order: string[];
}

export function emptyDraft(): ReportDraft {
  return { v: REPORT_DRAFT_VERSION, title: null, opponent: null, intro: "", sections: [], placements: {}, order: [] };
}

/** "#7 Alva Berg", or "Alva Berg" when the player has no number. */
export function sectionLabel(player: Pick<StatsCardPlayer, "name" | "number">): string {
  return player.number ? `#${player.number} ${player.name}` : player.name;
}

export function sectionOf(draft: ReportDraft, playerId: string): DraftSection | undefined {
  return draft.sections.find((s) => s.player.id === playerId);
}

// ---------------------------------------------------------------------------
// Reading a stored draft
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parsePlayer(raw: unknown): StatsCardPlayer | null {
  if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  return {
    id: raw.id,
    name: raw.name,
    number: strOrNull(raw.number),
    teamId: strOrNull(raw.teamId),
    teamName: typeof raw.teamName === "string" ? raw.teamName : "",
  };
}

/**
 * A stored draft, or null when it isn't one this build can read. A section
 * whose player can't be read is dropped; a second section about the same
 * player too (the first wins); a stats snapshot that no longer parses becomes
 * "no stats" (the player and the note stay).
 */
export function parseReportDraft(raw: unknown): ReportDraft | null {
  if (!isObj(raw) || raw.v !== REPORT_DRAFT_VERSION || !Array.isArray(raw.sections) || !isObj(raw.placements)) return null;
  const sections: DraftSection[] = [];
  const seen = new Set<string>();
  for (const s of raw.sections) {
    if (!isObj(s) || typeof s.id !== "string") continue;
    const player = parsePlayer(s.player);
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    sections.push({
      id: s.id,
      player,
      note: typeof s.note === "string" ? s.note.slice(0, REPORT_NOTE_STORED_MAX) : "",
      stats: s.stats == null ? null : parseCardSpec(s.stats),
    });
  }
  const placements: Record<string, Placement> = {};
  for (const [key, value] of Object.entries(raw.placements)) {
    if (typeof value === "string") placements[key] = value;
  }
  const order: string[] = [];
  if (Array.isArray(raw.order)) {
    const named = new Set<string>();
    for (const key of raw.order) {
      if (typeof key !== "string" || named.has(key)) continue;
      named.add(key);
      order.push(key);
    }
  }
  const title = strOrNull(raw.title);
  const opponent = strOrNull(raw.opponent);
  return {
    v: REPORT_DRAFT_VERSION,
    title: title === null ? null : title.slice(0, REPORT_TITLE_MAX),
    opponent: opponent === null ? null : opponent.slice(0, 80),
    intro: typeof raw.intro === "string" ? raw.intro.slice(0, REPORT_INTRO_LIMIT) : "",
    sections,
    placements,
    order,
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const defaultId = (): string => crypto.randomUUID();

/** Appends a section per player, in order; a player who has one is skipped; stops at the limit. */
export function addSections(draft: ReportDraft, players: readonly StatsCardPlayer[], newId: () => string = defaultId): ReportDraft {
  const taken = new Set(draft.sections.map((s) => s.player.id));
  const added: DraftSection[] = [];
  for (const player of players) {
    if (taken.has(player.id) || draft.sections.length + added.length >= REPORT_MAX_SECTIONS) continue;
    taken.add(player.id);
    added.push({ id: newId(), player, note: "", stats: null });
  }
  return added.length === 0 ? draft : { ...draft, sections: [...draft.sections, ...added] };
}

/** Removes the section and every placement that pointed at it. */
export function removeSection(draft: ReportDraft, id: string): ReportDraft {
  if (!draft.sections.some((s) => s.id === id)) return draft;
  const placements: Record<string, Placement> = {};
  for (const [key, to] of Object.entries(draft.placements)) if (to !== id) placements[key] = to;
  return { ...draft, sections: draft.sections.filter((s) => s.id !== id), placements };
}

export function moveSection(draft: ReportDraft, id: string, toIndex: number): ReportDraft {
  const from = draft.sections.findIndex((s) => s.id === id);
  if (from < 0) return draft;
  const to = Math.max(0, Math.min(toIndex, draft.sections.length - 1));
  if (to === from) return draft;
  const sections = [...draft.sections];
  const [section] = sections.splice(from, 1);
  sections.splice(to, 0, section);
  return { ...draft, sections };
}

function updateSection(draft: ReportDraft, id: string, change: (s: DraftSection) => DraftSection): ReportDraft {
  const at = draft.sections.findIndex((s) => s.id === id);
  if (at < 0) return draft;
  const next = change(draft.sections[at]);
  if (next === draft.sections[at]) return draft;
  const sections = [...draft.sections];
  sections[at] = next;
  return { ...draft, sections };
}

/**
 * Whose section it is; unchanged when another section already has that
 * player. The same player with better details (the box score's number and
 * team) is taken.
 */
export function setSectionPlayer(draft: ReportDraft, id: string, player: StatsCardPlayer): ReportDraft {
  const other = sectionOf(draft, player.id);
  if (other && other.id !== id) return draft;
  return updateSection(draft, id, (s) => (samePlayer(s.player, player) ? s : { ...s, player }));
}

function samePlayer(a: StatsCardPlayer, b: StatsCardPlayer): boolean {
  return a.id === b.id && a.name === b.name && a.number === b.number && a.teamId === b.teamId && a.teamName === b.teamName;
}

export function setNote(draft: ReportDraft, id: string, note: string): ReportDraft {
  const held = note.slice(0, REPORT_NOTE_LIMIT);
  return updateSection(draft, id, (s) => (s.note === held ? s : { ...s, note: held }));
}

export function setStats(draft: ReportDraft, id: string, stats: StatsCardSpec | null): ReportDraft {
  return updateSection(draft, id, (s) => (s.stats === stats ? s : { ...s, stats }));
}

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

const blankToNull = (v: string | null, max: number): string | null => (v === null || v.trim() === "" ? null : v.slice(0, max));

export function setTitle(draft: ReportDraft, title: string | null): ReportDraft {
  const next = blankToNull(title, REPORT_TITLE_MAX);
  return next === draft.title ? draft : { ...draft, title: next };
}

export function setOpponent(draft: ReportDraft, opponent: string | null): ReportDraft {
  const next = blankToNull(opponent, 80);
  return next === draft.opponent ? draft : { ...draft, opponent: next };
}

export function setIntro(draft: ReportDraft, intro: string): ReportDraft {
  const next = intro.slice(0, REPORT_INTRO_LIMIT);
  return next === draft.intro ? draft : { ...draft, intro: next };
}

/**
 * The opponent to start with: the team most sections are about (a tie keeps
 * the first). Null when no section names a team.
 */
export function defaultOpponent(draft: ReportDraft): string | null {
  const counts = new Map<string, number>();
  for (const s of draft.sections) {
    const team = s.player.teamName.trim();
    if (team) counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [team, c] of counts) {
    if (c > n) {
      best = team;
      n = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Placements and the layout
// ---------------------------------------------------------------------------

function isTarget(draft: ReportDraft, to: Placement): boolean {
  return to === TEAM_SECTION || draft.sections.some((s) => s.id === to);
}

/**
 * Puts a clip under a player (or the team) by hand, where its rank in the
 * order puts it. Unchanged for a target that doesn't exist. The editor moves
 * clips with moveClips, which also says where in the section they go.
 */
export function moveClip(draft: ReportDraft, key: string, to: Placement): ReportDraft {
  if (!isTarget(draft, to) || draft.placements[key] === to) return draft;
  return { ...draft, placements: { ...draft.placements, [key]: to } };
}

/** Lets the clip follow its player again. */
export function clearPlacement(draft: ReportDraft, key: string): ReportDraft {
  if (!(key in draft.placements)) return draft;
  const placements = { ...draft.placements };
  delete placements[key];
  return { ...draft, placements };
}

/**
 * Drops placements and order entries for clips that left the playlist, and
 * placements at targets that are gone. Call before a save.
 */
export function pruneDraft(draft: ReportDraft, items: readonly PlaylistItem[]): ReportDraft {
  const keys = new Set(items.filter(isClipItem).map(itemKey));
  const kept: Record<string, Placement> = {};
  let dropped = false;
  for (const [key, to] of Object.entries(draft.placements)) {
    if (keys.has(key) && (to === LEFT_OUT || isTarget(draft, to))) kept[key] = to;
    else dropped = true;
  }
  const order = draft.order.filter((key) => keys.has(key));
  if (!dropped && order.length === draft.order.length) return draft;
  return { ...draft, placements: dropped ? kept : draft.placements, order: order.length === draft.order.length ? draft.order : order };
}

/** Where a clip goes: left out, its placement, else its player's section, else the team. */
export function placementOf(draft: ReportDraft, item: PlaylistClipItem, event: PlayByPlayEvent | undefined): Placement {
  const placed = draft.placements[itemKey(item)];
  if (placed === LEFT_OUT) return LEFT_OUT;
  if (placed !== undefined && isTarget(draft, placed)) return placed;
  const playerId = event?.player ? String(event.player.playerId) : null;
  const own = playerId === null ? undefined : sectionOf(draft, playerId);
  return own ? own.id : TEAM_SECTION;
}

export interface ReportLayoutSection {
  /** TEAM_SECTION, or the draft section's id. */
  id: Placement;
  /** Null for the team section. */
  section: DraftSection | null;
  /** In reading order (the draft's order, then playlist order); shipped or not. */
  clips: PlaylistClipItem[];
}

export interface ReportLayout {
  /**
   * The team first (only when it has an intro or clips, unless `keepTeam`),
   * then the draft's sections in order, empty ones included.
   */
  sections: ReportLayoutSection[];
  /** Clips the coach left out of the report, in playlist order. */
  leftOut: PlaylistClipItem[];
  /** Clips whose play the game data no longer has: placed nowhere. */
  missing: { key: string; matchId: string; eventId: number }[];
}

/** The ranked clips by rank, then the rest as they came (playlist order). */
function inOrder(clips: PlaylistClipItem[], rank: ReadonlyMap<string, number>): PlaylistClipItem[] {
  const ranked = clips.filter((c) => rank.has(itemKey(c))).sort((a, b) => rank.get(itemKey(a))! - rank.get(itemKey(b))!);
  return ranked.length === 0 ? clips : [...ranked, ...clips.filter((c) => !rank.has(itemKey(c)))];
}

/**
 * The report's shape for a playlist: which clips sit under which section, in
 * which order. Text and stats cards are not part of it. The editor keeps the
 * Team section even when it is empty (`keepTeam`), so it can be written in
 * and dropped on; the published report leaves an empty one out.
 */
export function deriveReportLayout(
  draft: ReportDraft,
  items: readonly PlaylistItem[],
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>,
  opts: { keepTeam?: boolean } = {},
): ReportLayout {
  const byId = new Map<Placement, ReportLayoutSection>();
  const team: ReportLayoutSection = { id: TEAM_SECTION, section: null, clips: [] };
  byId.set(TEAM_SECTION, team);
  for (const s of draft.sections) byId.set(s.id, { id: s.id, section: s, clips: [] });
  const leftOut: PlaylistClipItem[] = [];
  const missing: ReportLayout["missing"] = [];
  for (const item of items) {
    if (!isClipItem(item)) continue;
    const key = itemKey(item);
    const event = eventByKey.get(key);
    if (!event) {
      missing.push({ key, matchId: item.matchId, eventId: item.eventId });
      continue;
    }
    const to = placementOf(draft, item, event);
    if (to === LEFT_OUT) leftOut.push(item);
    else byId.get(to)!.clips.push(item);
  }
  if (draft.order.length > 0) {
    const rank = new Map(draft.order.map((key, i) => [key, i]));
    for (const s of byId.values()) s.clips = inOrder(s.clips, rank);
  }
  const players = draft.sections.map((s) => byId.get(s.id)!);
  const sections = opts.keepTeam || team.clips.length > 0 || draft.intro.trim() ? [team, ...players] : players;
  return { sections, leftOut, missing };
}

// ---------------------------------------------------------------------------
// Arranging clips
// ---------------------------------------------------------------------------

/** Each section's clip keys in reading order, the team first even when the layout left it out. */
function arrangementOf(layout: ReportLayout): Map<Placement, string[]> {
  const lists = new Map<Placement, string[]>([[TEAM_SECTION, []]]);
  for (const s of layout.sections) lists.set(s.id, s.clips.map(itemKey));
  return lists;
}

const arrangementKey = (lists: ReadonlyMap<Placement, readonly string[]>, leftOut: Iterable<string>) =>
  JSON.stringify([[...lists], [...leftOut].sort()]);

/**
 * Moves clips (in the order they read now, wherever they are) to a section,
 * before the clip `before` there or at its end, or out of the report
 * (LEFT_OUT). Writes the placements and the whole reading order. `layout` is
 * this draft's (deriveReportLayout). Unchanged for a target that isn't one,
 * for clips the layout doesn't hold, and for a move that puts the clips
 * where they already are.
 */
export function moveClips(draft: ReportDraft, layout: ReportLayout, keys: readonly string[], to: Placement, before: string | null): ReportDraft {
  if (to !== LEFT_OUT && !isTarget(draft, to)) return draft;
  const lists = arrangementOf(layout);
  const out = layout.leftOut.map(itemKey);
  const wanted = new Set(keys);
  const moving = [...[...lists.values()].flat(), ...out].filter((key) => wanted.has(key));
  if (moving.length === 0) return draft;
  const was = arrangementKey(lists, out);

  const moved = new Set(moving);
  for (const [id, list] of lists) lists.set(id, list.filter((key) => !moved.has(key)));
  const stillOut = out.filter((key) => !moved.has(key));
  if (to === LEFT_OUT) {
    stillOut.push(...moving);
  } else {
    const target = lists.get(to) ?? [];
    const at = before === null ? -1 : target.indexOf(before);
    target.splice(at < 0 ? target.length : at, 0, ...moving);
    lists.set(to, target);
  }
  if (arrangementKey(lists, stillOut) === was) return draft;

  const placements = { ...draft.placements };
  for (const key of moving) placements[key] = to;
  return { ...draft, placements, order: [...lists.values()].flat() };
}

/** Puts clips back in the report: each follows its player again (to the end of their clips). */
export function includeClips(draft: ReportDraft, keys: readonly string[]): ReportDraft {
  const placed = keys.filter((key) => key in draft.placements);
  if (placed.length === 0) return draft;
  const placements = { ...draft.placements };
  for (const key of placed) delete placements[key];
  return { ...draft, placements };
}

/**
 * Where ⌥↑ / ⌥↓ takes clips: one place up or down in their section, or over
 * its edge to the end of the section above or the start of the one below.
 * A selection moves from its first clip (up) or its last (down). Null at the
 * top and bottom of the report, and for left-out clips.
 */
export function nudgeClips(layout: ReportLayout, keys: readonly string[], dir: -1 | 1): { to: Placement; before: string | null } | null {
  const wanted = new Set(keys);
  if (layout.leftOut.some((c) => wanted.has(itemKey(c)))) return null;
  const lists = layout.sections.map((s) => ({ id: s.id, keys: s.clips.map(itemKey) }));
  const reading = lists.flatMap((l) => l.keys).filter((key) => wanted.has(key));
  if (reading.length === 0) return null;
  const anchor = dir < 0 ? reading[0] : reading[reading.length - 1];
  const at = lists.findIndex((l) => l.keys.includes(anchor));
  const list = lists[at].keys;
  const rest = list.filter((key) => !wanted.has(key));
  // How many of the others read before the anchor.
  const r = list.slice(0, list.indexOf(anchor)).filter((key) => !wanted.has(key)).length;
  if (dir < 0) {
    if (r > 0) return { to: lists[at].id, before: rest[r - 1] };
    const above = lists[at - 1];
    return above ? { to: above.id, before: null } : null;
  }
  if (r < rest.length) return { to: lists[at].id, before: rest[r + 1] ?? null };
  const below = lists[at + 1];
  return below ? { to: below.id, before: below.keys.find((key) => !wanted.has(key)) ?? null } : null;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** A change to the report's structure: who is in it, in which order, and where the clips go. */
export type ReportEdit = Edit<ReportDraft>;

/** The structure, for telling a move from a change of words. */
export function structureKey(draft: ReportDraft): string {
  return JSON.stringify([draft.sections.map((s) => s.id), Object.entries(draft.placements).sort(), draft.order]);
}

/**
 * The snapshot's structure with today's words: its sections, each as it is
 * now where it still exists (a note typed since stays), else as the snapshot
 * had it; its placements and order; the title, opponent and intro as now.
 */
export function restoreStructure(snapshot: ReportDraft, now: ReportDraft): ReportDraft {
  const current = new Map(now.sections.map((s) => [s.id, s]));
  const sections = snapshot.sections.map((s) => current.get(s.id) ?? s);
  const next: ReportDraft = { ...now, sections, placements: snapshot.placements, order: snapshot.order };
  const same = sections.length === now.sections.length && sections.every((s, i) => s === now.sections[i]);
  return same && structureKey(next) === structureKey(now) ? now : next;
}

/** Adds a report edit to the undo stack; one that only changed words is not one. */
export function recordReportEdit(history: History<ReportEdit>, edit: ReportEdit): History<ReportEdit> {
  return structureKey(edit.before) === structureKey(edit.after) ? history : pushEdit(history, edit);
}

/** The stored size of a draft, as the table measures it. */
export function draftBytes(draft: ReportDraft): number {
  return new TextEncoder().encode(JSON.stringify(draft)).length;
}
