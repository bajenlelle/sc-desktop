/**
 * Pure tree helpers for nested playlist folders.
 *
 * Defensive by design: a folder whose parentId points at a missing folder, or
 * that participates in a cycle (possible only through data races — the DB
 * trigger rejects cycles), is treated as a ROOT so nothing ever disappears
 * from the sidebar. Every walk is cycle-safe via visited sets.
 */

import type { PlaylistFolder } from "../types/match";

export interface FolderTreeNode {
  folder: PlaylistFolder;
  depth: number;
  children: FolderTreeNode[];
}

/** Deterministic sibling order: sortOrder asc, then name (sv, case-insensitive), then id. */
export function compareFolders(a: PlaylistFolder, b: PlaylistFolder): number {
  return (
    a.sortOrder - b.sortOrder ||
    a.name.localeCompare(b.name, "sv", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Map of parent key (folder id, or null for roots) -> sorted children.
 * Orphans (parentId not in the set) and cycle members surface as roots.
 */
export function childFoldersByParent(
  folders: PlaylistFolder[],
): Map<string | null, PlaylistFolder[]> {
  const ids = new Set(folders.map((f) => f.id));

  // Roots = no parent or unknown parent. Cycle members have known parents but
  // are unreachable from any root — find them by walking down from the roots.
  const reachable = new Set<string>();
  const provisional = new Map<string | null, PlaylistFolder[]>();
  for (const f of folders) {
    const key = f.parentId !== undefined && ids.has(f.parentId) ? f.parentId : null;
    if (!provisional.has(key)) provisional.set(key, []);
    provisional.get(key)!.push(f);
  }
  const queue = [...(provisional.get(null) ?? [])];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (reachable.has(f.id)) continue;
    reachable.add(f.id);
    queue.push(...(provisional.get(f.id) ?? []));
  }

  const result = new Map<string | null, PlaylistFolder[]>();
  for (const f of folders) {
    const key =
      f.parentId !== undefined && ids.has(f.parentId) && reachable.has(f.id)
        ? f.parentId
        : null;
    if (!result.has(key)) result.set(key, []);
    result.get(key)!.push(f);
  }
  for (const children of result.values()) children.sort(compareFolders);
  return result;
}

/** Roots with recursive children and depth. */
export function buildFolderTree(folders: PlaylistFolder[]): FolderTreeNode[] {
  const byParent = childFoldersByParent(folders);
  const build = (f: PlaylistFolder, depth: number): FolderTreeNode => ({
    folder: f,
    depth,
    children: (byParent.get(f.id) ?? []).map((c) => build(c, depth + 1)),
  });
  return (byParent.get(null) ?? []).map((f) => build(f, 0));
}

/** Pre-order DFS of the tree — for Move-to submenus and <select> options. */
export function flattenFolderTree(
  folders: PlaylistFolder[],
): Array<{ folder: PlaylistFolder; depth: number }> {
  const out: Array<{ folder: PlaylistFolder; depth: number }> = [];
  const walk = (nodes: FolderTreeNode[]) => {
    for (const n of nodes) {
      out.push({ folder: n.folder, depth: n.depth });
      walk(n.children);
    }
  };
  walk(buildFolderTree(folders));
  return out;
}

/** All folder ids in the subtree rooted at rootId, INCLUDING rootId itself. */
export function collectSubtreeIds(folders: PlaylistFolder[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === undefined) continue;
    if (!byParent.has(f.parentId)) byParent.set(f.parentId, []);
    byParent.get(f.parentId)!.push(f.id);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const child of byParent.get(queue.pop()!) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

/** True when folderId is a STRICT descendant of ancestorId. */
export function isDescendantOf(
  folders: PlaylistFolder[],
  folderId: string,
  ancestorId: string,
): boolean {
  if (folderId === ancestorId) return false;
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
  const seen = new Set<string>();
  let cur = parentOf.get(folderId);
  while (cur !== undefined && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}

/**
 * True when re-parenting folderId under newParentId would create a cycle —
 * i.e. onto itself or into its own subtree. null (root) is always safe.
 */
export function wouldCreateCycle(
  folders: PlaylistFolder[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;
  return isDescendantOf(folders, newParentId, folderId);
}

/**
 * folderId -> every STRICT descendant of it, in one pass over the list.
 *
 * For UI that tests many re-parent targets at once (a Move-to submenu asks
 * once per target, per row): `wouldCreateCycle` rebuilds a parent map and
 * walks ancestors on every call, so a submenu costs O(F²) and a whole sidebar
 * O(F³). Build this once per folder list and each check is a Set lookup.
 *
 * Built by walking UP from each folder and claiming it as a descendant of
 * every ancestor reached — the same traversal `isDescendantOf` performs, so
 * the two agree by construction, including on orphans (a parentId pointing at
 * a missing folder simply ends the walk) and cycle members (a folder is never
 * a descendant of itself, matching `isDescendantOf`'s equal-ids early return).
 */
export function buildDescendantMap(
  folders: PlaylistFolder[],
): Map<string, Set<string>> {
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
  const out = new Map<string, Set<string>>();
  for (const f of folders) {
    const seen = new Set<string>();
    let cur = parentOf.get(f.id);
    while (cur !== undefined && !seen.has(cur) && cur !== f.id) {
      seen.add(cur);
      if (!out.has(cur)) out.set(cur, new Set<string>());
      out.get(cur)!.add(f.id);
      cur = parentOf.get(cur);
    }
  }
  return out;
}

/** `wouldCreateCycle` against a prebuilt `buildDescendantMap`. */
export function wouldCreateCycleWith(
  descendants: Map<string, Set<string>>,
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;
  return descendants.get(folderId)?.has(newParentId) ?? false;
}

/**
 * Counts for the delete-confirm dialog. folderCount EXCLUDES the root (it's
 * the "N subfolders" figure); playlistCount covers the whole subtree.
 */
export function subtreeStats(
  folders: PlaylistFolder[],
  playlists: Array<{ folderId?: string }>,
  rootId: string,
): { folderCount: number; playlistCount: number } {
  const ids = collectSubtreeIds(folders, rootId);
  return {
    folderCount: ids.size - 1,
    playlistCount: playlists.filter((p) => p.folderId !== undefined && ids.has(p.folderId)).length,
  };
}

/** Folder names from root ancestor down to id, e.g. ["Season 25/26", "Scrimmages"]. */
export function folderPath(folders: PlaylistFolder[], id: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur.name);
    seen.add(cur.id);
    cur = cur.parentId !== undefined ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Ids of id's ancestors, nearest first. Cycle-safe. */
export function ancestorIds(folders: PlaylistFolder[], id: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id);
  while (cur && cur.parentId !== undefined && !seen.has(cur.parentId)) {
    out.push(cur.parentId);
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Browsing one folder at a time (the web's Playlists page). These follow the
// tree as childFoldersByParent shows it, so what a page lists, the path it
// shows and the moves it offers always agree, orphans included.
// ---------------------------------------------------------------------------

/** folderId -> the parent it is shown under (null = the top level), per childFoldersByParent. */
export function shownParentMap(folders: PlaylistFolder[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [parent, children] of childFoldersByParent(folders)) {
    for (const child of children) out.set(child.id, parent);
  }
  return out;
}

/**
 * The folder a playlist is listed in: its own when that folder is in the
 * set, else the top level (null). The same rule childFoldersByParent applies
 * to an orphaned folder, so a playlist never disappears from view.
 */
export function placedFolderId(
  knownFolderIds: ReadonlySet<string>,
  folderId: string | null | undefined,
): string | null {
  return folderId != null && knownFolderIds.has(folderId) ? folderId : null;
}

/**
 * The folders from the top level down to `id`, inclusive: the path a
 * breadcrumb shows. [] when id is unknown.
 */
export function folderTrail(folders: PlaylistFolder[], id: string): PlaylistFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  if (!byId.has(id)) return [];
  const parentOf = shownParentMap(folders);
  const out: PlaylistFolder[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const folder = byId.get(cur);
    if (!folder) break;
    out.unshift(folder);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

/**
 * folderId -> the names from the top level down to it (folderTrail's
 * names), for every folder in one walk of the tree: search text and
 * "Season 25/26 / Scouting" descriptions without a walk per folder.
 */
export function folderPathNames(folders: PlaylistFolder[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (nodes: FolderTreeNode[], prefix: string[]) => {
    for (const node of nodes) {
      const path = [...prefix, node.folder.name];
      out.set(node.folder.id, path);
      walk(node.children, path);
    }
  };
  walk(buildFolderTree(folders), []);
  return out;
}

/**
 * folderId -> how many playlists sit in that folder or anywhere under it:
 * the count beside a folder row. Agrees with subtreeStats' playlistCount;
 * playlists whose folder is unknown count nowhere (they show at the top
 * level). Cycle-safe.
 */
export function subtreePlaylistCounts(
  folders: PlaylistFolder[],
  playlists: ReadonlyArray<{ folderId?: string }>,
): Map<string, number> {
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
  const counts = new Map<string, number>();
  for (const p of playlists) {
    const seen = new Set<string>();
    let cur = p.folderId;
    while (cur !== undefined && parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      counts.set(cur, (counts.get(cur) ?? 0) + 1);
      cur = parentOf.get(cur);
    }
  }
  return counts;
}

/** What is being moved: a playlist (where it is now) or a folder (by id). */
export type FolderMoveSubject =
  | { kind: "playlist"; folderId?: string | null }
  | { kind: "folder"; id: string };

export interface FolderMoveTarget {
  /** The destination; null = the top level. */
  folderId: string | null;
  /** The destination folder; absent for the top level. */
  folder?: PlaylistFolder;
  /** Indent: the top level is 0, the folders at the top level 1, and so on. */
  depth: number;
  /**
   * Why it can't be picked, or false: where the subject already is
   * ("current"), the folder being moved ("self"), or a folder inside it
   * ("inside", which would make a cycle).
   */
  disabled: false | "current" | "self" | "inside";
}

/**
 * Every place a playlist or folder could move to, for a Move to… picker:
 * the top level, then the tree in sidebar order. The subject's current
 * place is disabled; a folder can't go into itself or anything under it.
 */
export function folderMoveTargets(
  folders: PlaylistFolder[],
  subject: FolderMoveSubject,
): FolderMoveTarget[] {
  let current: string | null;
  let inside: ReadonlySet<string> = new Set<string>();
  if (subject.kind === "playlist") {
    current = placedFolderId(new Set(folders.map((f) => f.id)), subject.folderId);
  } else {
    current = shownParentMap(folders).get(subject.id) ?? null;
    inside = buildDescendantMap(folders).get(subject.id) ?? inside;
  }
  const out: FolderMoveTarget[] = [
    { folderId: null, depth: 0, disabled: current === null ? "current" : false },
  ];
  for (const { folder, depth } of flattenFolderTree(folders)) {
    const disabled =
      subject.kind === "folder" && folder.id === subject.id
        ? "self"
        : inside.has(folder.id)
          ? "inside"
          : folder.id === current
            ? "current"
            : false;
    out.push({ folderId: folder.id, folder, depth: depth + 1, disabled });
  }
  return out;
}

/**
 * Which way a move between two folders goes, for a push-style transition:
 * 1 deeper (into a folder under `from`), -1 back up (to a folder above it),
 * 0 sideways or unrelated. null is the top level.
 */
export function folderNavDirection(
  folders: PlaylistFolder[],
  from: string | null,
  to: string | null,
): -1 | 0 | 1 {
  if (from === to) return 0;
  const toTrail = to === null ? [] : folderTrail(folders, to).map((f) => f.id);
  const fromTrail = from === null ? [] : folderTrail(folders, from).map((f) => f.id);
  if (from === null) return toTrail.length > 0 ? 1 : 0;
  if (to === null) return fromTrail.length > 0 ? -1 : 0;
  if (toTrail.includes(from)) return 1;
  if (fromTrail.includes(to)) return -1;
  return 0;
}
