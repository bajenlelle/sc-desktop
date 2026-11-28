/**
 * The scouting report's side panel as a flat list of rows, for the desktop's
 * drag engine (which works on one list of rows with gaps between them): a
 * header per section with its clips under it, in the report's order, and the
 * clips left out of the report last. Pure, so where a drop lands is tested
 * here; the view turns it into report-draft ops (moveClips, moveSection).
 */
import { itemKey } from "./playlist-edits";
import { LEFT_OUT, PLAYERS_BLOCK, TEAM_SECTION, type Placement, type ReportLayout } from "./report-draft";

export interface OutlineRowRef {
  /** The row's data-row-key: `section:<id>` for a header, the clip key for a clip. */
  key: string;
  kind: "section" | "clip";
  /** The section the row is (a header) or sits in (a clip); LEFT_OUT for the left-out group. */
  id: Placement;
  clipKey?: string;
  /** A header: it is a player's (players move among players). */
  player?: boolean;
  /** A header: clips can be dropped in it (not How they play, not Their games). */
  accepts?: boolean;
  /** A header: players don't see the section. */
  hidden?: boolean;
  /** A header: the report block it belongs to (PLAYERS_BLOCK for a player's); none for the left-out group. */
  block?: string;
}

export const sectionRowKey = (id: Placement) => `section:${id}`;

/** The rows as they show: every header, and the clips of each section that isn't collapsed. */
export function outlineRows(layout: ReportLayout, collapsed: ReadonlySet<Placement>): OutlineRowRef[] {
  const rows: OutlineRowRef[] = [];
  const push = (id: Placement, clipKeys: string[], head: Pick<OutlineRowRef, "player" | "accepts" | "hidden" | "block">) => {
    rows.push({ key: sectionRowKey(id), kind: "section", id, ...head });
    if (collapsed.has(id)) return;
    for (const clipKey of clipKeys) rows.push({ key: clipKey, kind: "clip", id, clipKey });
  };
  for (const s of layout.sections) {
    push(s.id, s.clips.map(itemKey), { player: !!s.section, accepts: s.accepts, hidden: s.hidden, block: s.block?.id ?? (s.section ? PLAYERS_BLOCK : undefined) });
  }
  push(LEFT_OUT, layout.leftOut.map(itemKey), { player: false, accepts: true, hidden: false });
  return rows;
}

/** A clip lands below the Team header at the highest. */
export function snapClipGap(gap: number): number {
  return Math.max(1, gap);
}

/**
 * Where dragged clips land at a gap: in the section whose header is the
 * nearest above it, before the next clip of that section that isn't being
 * dragged, or at its end (always, for a collapsed section).
 */
export function clipDrop(rows: readonly OutlineRowRef[], blockKeys: readonly string[], gap: number): { to: Placement; before: string | null } {
  const at = snapClipGap(gap);
  let header = at - 1;
  // The nearest section above that takes clips (How they play and Their games don't).
  while (header > 0 && (rows[header].kind !== "section" || rows[header].accepts === false)) header--;
  const to = rows[header]?.id ?? TEAM_SECTION;
  const dragged = new Set(blockKeys);
  for (let i = at; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "section") break;
    if (!dragged.has(row.key)) return { to, before: row.clipKey ?? null };
  }
  return { to, before: null };
}

const isPlayerHeader = (row: OutlineRowRef) => row.kind === "section" && (row.player ?? (row.id !== TEAM_SECTION && row.id !== LEFT_OUT));

/**
 * The gap a dragged player (its header and clips) settles on: the nearest
 * one between two players, at a tie the upper. Never inside the Team section
 * or the left-out group.
 */
export function sectionGap(rows: readonly OutlineRowRef[], gap: number): number {
  const gaps: number[] = [];
  rows.forEach((row, i) => {
    if (isPlayerHeader(row) || (row.kind === "section" && row.id === LEFT_OUT)) gaps.push(i);
  });
  if (gaps.length === 0) return gap;
  return gaps.reduce((best, g) => (Math.abs(g - gap) < Math.abs(best - gap) ? g : best));
}

/** The dragged player's place among the players after a drop at the gap (moveSection's toIndex). */
export function sectionDropIndex(rows: readonly OutlineRowRef[], blockKeys: readonly string[], gap: number): number {
  const dragged = new Set(blockKeys);
  let index = 0;
  for (let i = 0; i < Math.min(gap, rows.length); i++) {
    if (isPlayerHeader(rows[i]) && !dragged.has(rows[i].key)) index++;
  }
  return index;
}

/** The header rows where a block starts (a players block at its first player), and the left-out group's. */
function blockStarts(rows: readonly OutlineRowRef[]): number[] {
  const starts: number[] = [];
  let last: string | undefined;
  rows.forEach((row, i) => {
    if (row.kind !== "section") return;
    if (row.id === LEFT_OUT) starts.push(i);
    else if (row.block !== undefined && row.block !== last) starts.push(i);
    last = row.block;
  });
  return starts;
}

/**
 * The gap a dragged section that isn't a player's (Keys, Their actions, a
 * section of the coach's own…) settles on: the nearest one between two
 * sections, at a tie the upper. Never between two players (they are one
 * block) and never below the left-out group.
 */
export function blockGap(rows: readonly OutlineRowRef[], gap: number): number {
  const gaps = blockStarts(rows);
  if (gaps.length === 0) return gap;
  return gaps.reduce((best, g) => (Math.abs(g - gap) < Math.abs(best - gap) ? g : best));
}

/**
 * The block a dragged section lands before after a drop at the gap
 * (moveBlockBefore's `before`), or null for after the last. Its own rows
 * don't count: dropped where it was, it lands before the block it was before.
 */
export function blockDropBefore(rows: readonly OutlineRowRef[], blockKeys: readonly string[], gap: number): string | null {
  const dragged = new Set(blockKeys);
  for (let i = Math.max(0, gap); i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "section" || dragged.has(row.key)) continue;
    return row.id === LEFT_OUT ? null : (row.block ?? null);
  }
  return null;
}
