/**
 * Clip-group ordering math for the playlist editor (ordering lock):
 * block moves, drop-gap snapping around group runs, and group dissolution.
 * Pure combinatorics extracted from the desktop editor — these are exercised
 * through HTML5 drag-and-drop, which makes the edge cases effectively
 * untestable by hand.
 */

import type { PlaylistItem } from "../types/match";

/** A row's placement within its group's contiguous run. */
export type GroupRunPos = "first" | "middle" | "last" | "only";
export interface GroupRunInfo {
  groupId: string;
  pos: GroupRunPos;
  size: number;
}

/**
 * Remove the items at blockIndices (ascending) from list and reinsert them,
 * contiguously and in the same relative order, at gap position `gap`
 * (0..list.length, counted in the ORIGINAL list). Generalizes the old
 * single-item `insertIndex > sourceIndex ? insertIndex - 1 : insertIndex`.
 */
export function moveBlock<T>(list: readonly T[], blockIndices: number[], gap: number): T[] {
  const set = new Set(blockIndices);
  const moved = blockIndices.map((i) => list[i]);
  const rest = list.filter((_, i) => !set.has(i));
  const adjusted = gap - blockIndices.filter((i) => i < gap).length;
  return [...rest.slice(0, adjusted), ...moved, ...rest.slice(adjusted)];
}

/**
 * A drop gap strictly inside a foreign group's run snaps to the run's nearest
 * boundary (tie → after the group). Gaps at run edges, and gaps inside a run
 * that belongs to the dragged block itself, pass through unchanged.
 */
export function snapGapToGroupBoundary<T>(
  gap: number,
  list: readonly T[],
  keyOf: (item: T) => string,
  groupIdOf: ReadonlyMap<string, string>,
  excludedKeys: ReadonlySet<string>,
): number {
  if (gap <= 0 || gap >= list.length) return gap;
  const gidBefore = groupIdOf.get(keyOf(list[gap - 1]));
  const gidAfter = groupIdOf.get(keyOf(list[gap]));
  if (!gidBefore || gidBefore !== gidAfter) return gap;
  if (excludedKeys.has(keyOf(list[gap]))) return gap;
  let s = gap - 1;
  while (s > 0 && groupIdOf.get(keyOf(list[s - 1])) === gidBefore) s--;
  let e = gap + 1;
  while (e < list.length && groupIdOf.get(keyOf(list[e])) === gidBefore) e++;
  return gap - s < e - gap ? s : e;
}

/** key -> run info over contiguous same-group runs, for group visuals. */
export function computeGroupRuns<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  groupIdOf: ReadonlyMap<string, string>,
): Map<string, GroupRunInfo> {
  const res = new Map<string, GroupRunInfo>();
  if (groupIdOf.size === 0) return res;
  let i = 0;
  while (i < list.length) {
    const gid = groupIdOf.get(keyOf(list[i]));
    if (!gid) { i++; continue; }
    let j = i + 1;
    while (j < list.length && groupIdOf.get(keyOf(list[j])) === gid) j++;
    const size = j - i;
    for (let p = i; p < j; p++) {
      res.set(keyOf(list[p]), {
        groupId: gid,
        size,
        pos: size === 1 ? "only" : p === i ? "first" : p === j - 1 ? "last" : "middle",
      });
    }
    i = j;
  }
  return res;
}

/** Auto-dissolve groups that fell below 2 members. */
export function normalizeGroups(items: PlaylistItem[]): PlaylistItem[] {
  const counts = new Map<string, number>();
  for (const it of items) if (it.groupId) counts.set(it.groupId, (counts.get(it.groupId) ?? 0) + 1);
  return items.map((it) => {
    if (!it.groupId || (counts.get(it.groupId) ?? 0) >= 2) return it;
    const { groupId: _g, ...rest } = it;
    return rest as PlaylistItem;
  });
}
