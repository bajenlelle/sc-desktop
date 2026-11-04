/**
 * The playlist editor's edits as pure functions over a Playlist: the item
 * key, grouping (the ordering lock: members stay contiguous and move as
 * one), and where a card goes. The web editor's edits (order, offsets, notes, cards, removal with
 * undo) join it from the cloud-videos branch.
 */
import type { PlaylistItem, PlaylistTextCard } from "../types/match";
import { isClipItem } from "../types/match";
import { moveBlock, normalizeGroups } from "./clip-groups";
import { fallbackText, type StatsCardSpec } from "./stats-card";

/** The key an item goes by in the editor: `<matchId>:<eventId>` for a clip, `text:<id>` for a card. */
export function itemKey(item: PlaylistItem): string {
  return isClipItem(item) ? `${item.matchId}:${item.eventId}` : `text:${item.id}`;
}

/**
 * The selected rows pulled together at the first member's place, in one new
 * group. Groups are atomic: a selection that touches an existing group
 * absorbs that whole group. Null when fewer than two rows are selected.
 */
export function groupItems(items: readonly PlaylistItem[], selectedKeys: ReadonlySet<string>, newGroupId: string): PlaylistItem[] | null {
  const keys = items.map(itemKey);
  const groupOf = new Map(items.map((it) => [itemKey(it), it.groupId]));
  const seed = keys.filter((k) => selectedKeys.has(k));
  if (seed.length < 2) return null;
  const absorbed = new Set(seed.map((k) => groupOf.get(k)).filter((g): g is string => !!g));
  const members = new Set(keys.filter((k) => selectedKeys.has(k) || absorbed.has(groupOf.get(k) ?? "")));
  const blockIndices = keys.map((k, i) => (members.has(k) ? i : -1)).filter((i) => i >= 0);
  // Pull-together semantics: the block lands at the first member's position
  // (moveBlock keeps the first member in place and pulls the rest up behind it).
  const moved = moveBlock(items, blockIndices, blockIndices[0]);
  return normalizeGroups(moved.map((it) => (members.has(itemKey(it)) ? { ...it, groupId: newGroupId } : it)));
}

/** The group dissolved: its members keep their places and lose the group. */
export function ungroupItems(items: readonly PlaylistItem[], groupId: string): PlaylistItem[] {
  return items.map((it) => {
    if (it.groupId !== groupId) return it;
    const { groupId: _g, ...rest } = it;
    return rest as PlaylistItem;
  });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Where a new card is asked for: the toolbar, above a row (by its index in the rows as shown), or the start. */
export type CardPlace = { at: "toolbar" } | { at: "above"; index: number } | { at: "start" };

/**
 * The key of the row a new card goes before, null for the end. From the
 * toolbar: after the focused (or playing) row, else at the start, where an
 * intro card belongs. From a row: above it. Never inside a group: above or
 * after the whole run instead. By key, so a slow stats lookup can't misplace it.
 */
export function cardInsertKey(items: readonly PlaylistItem[], place: CardPlace, focusKey: string | null): string | null {
  let gap: number;
  let after = false;
  if (place.at === "above") gap = place.index;
  else if (place.at === "start") gap = 0;
  else {
    const idx = focusKey ? items.findIndex((i) => itemKey(i) === focusKey) : -1;
    gap = idx >= 0 ? idx + 1 : 0;
    after = idx >= 0;
  }
  if (gap > 0 && gap < items.length) {
    const gid = items[gap].groupId;
    if (gid && items[gap - 1].groupId === gid) {
      if (after) while (gap < items.length && items[gap].groupId === gid) gap++;
      else while (gap > 0 && items[gap - 1].groupId === gid) gap--;
    }
  }
  return items[gap] ? itemKey(items[gap]) : null;
}

/** A new card: five seconds, empty, or a stats card with its readable fallback line. */
export function newTextCard(id: string, spec: StatsCardSpec | null): PlaylistTextCard {
  return {
    type: "text",
    id,
    text: spec ? fallbackText(spec) : "",
    durationSeconds: 5,
    ...(spec ? { card: spec } : {}),
  };
}

/** The item put before the row with `beforeKey`, or at the end when there is none. */
export function insertBefore(items: readonly PlaylistItem[], item: PlaylistItem, beforeKey: string | null): PlaylistItem[] {
  const found = beforeKey ? items.findIndex((i) => itemKey(i) === beforeKey) : -1;
  const at = found >= 0 ? found : items.length;
  return [...items.slice(0, at), item, ...items.slice(at)];
}
