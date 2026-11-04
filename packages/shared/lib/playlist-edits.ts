/**
 * The playlist editor's edits as pure functions over a Playlist: the item
 * key, and grouping (the ordering lock: members stay contiguous and move as
 * one). The web editor's edits (order, offsets, notes, cards, removal with
 * undo) join it from the cloud-videos branch.
 */
import type { PlaylistItem } from "../types/match";
import { isClipItem } from "../types/match";
import { moveBlock, normalizeGroups } from "./clip-groups";

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
