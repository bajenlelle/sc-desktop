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
