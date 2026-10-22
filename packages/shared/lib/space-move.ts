/**
 * Pure logic for the "Move content to a club" picker (desktop Settings, web
 * Profile): the folder tree, what a tick selects, what the move would do, and
 * its copy. The move itself is one server call (space-move-db.ts); the server
 * expands the request the same way (move_to_club in
 * supabase/migrations/20261028100000_move_to_club.sql).
 *
 * Selection rules:
 *   * ticking a folder ticks its whole subtree; the folder itself moves;
 *   * a folder counts as ticked when every playlist in it is, so ticking
 *     every playlist in a folder moves the folder too, with any empty
 *     subfolders (the server moves a folder's whole subtree);
 *   * a folder with no playlists anywhere inside counts as ticked only when
 *     it's ticked itself;
 *   * a ticked playlist brings the games its clips use ("auto" games), which
 *     can't be unticked on their own.
 */
import type {
  MoveDuplicate,
  MoveFolder,
  MovePlaylist,
  MovePreview,
  MoveRequest,
  MoveResult,
  MoveSelection,
  MoveErrorToken,
} from "../types/space-move";

export type CheckState = "checked" | "mixed" | "unchecked";

export interface MoveTreeNode {
  folder: MoveFolder;
  depth: number;
  children: MoveTreeNode[];
  playlists: MovePlaylist[];
}

export interface MoveTree {
  roots: MoveTreeNode[];
  /** Playlists outside any folder (or in a folder the preview doesn't list). */
  unfiled: MovePlaylist[];
}

export const EMPTY_SELECTION: MoveSelection = {
  folderIds: new Set(),
  playlistIds: new Set(),
  gameIds: new Set(),
};

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "sv", { sensitivity: "base" });
}

/**
 * Parent → children for the listed folders. A folder whose parent isn't
 * listed, or that sits in a cycle, is a root, so nothing disappears.
 */
function childMap(folders: readonly MoveFolder[]): Map<string | null, MoveFolder[]> {
  const ids = new Set(folders.map((f) => f.id));
  const provisional = new Map<string | null, MoveFolder[]>();
  for (const f of folders) {
    const key = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    provisional.set(key, [...(provisional.get(key) ?? []), f]);
  }
  const reachable = new Set<string>();
  const queue = [...(provisional.get(null) ?? [])];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (reachable.has(f.id)) continue;
    reachable.add(f.id);
    queue.push(...(provisional.get(f.id) ?? []));
  }
  const result = new Map<string | null, MoveFolder[]>();
  for (const f of folders) {
    const key = f.parentId && ids.has(f.parentId) && reachable.has(f.id) ? f.parentId : null;
    result.set(key, [...(result.get(key) ?? []), f]);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b) || a.id.localeCompare(b.id));
  }
  return result;
}

function playlistsByFolder(preview: MovePreview): Map<string | null, MovePlaylist[]> {
  const ids = new Set(preview.folders.map((f) => f.id));
  const map = new Map<string | null, MovePlaylist[]>();
  for (const p of preview.playlists) {
    const key = p.folderId && ids.has(p.folderId) ? p.folderId : null;
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  for (const list of map.values()) list.sort(byName);
  return map;
}

export function buildMoveTree(preview: MovePreview): MoveTree {
  const kids = childMap(preview.folders);
  const lists = playlistsByFolder(preview);
  const seen = new Set<string>();
  const build = (folder: MoveFolder, depth: number): MoveTreeNode => {
    seen.add(folder.id);
    return {
      folder,
      depth,
      children: (kids.get(folder.id) ?? []).filter((c) => !seen.has(c.id)).map((c) => build(c, depth + 1)),
      playlists: lists.get(folder.id) ?? [],
    };
  };
  return { roots: (kids.get(null) ?? []).map((f) => build(f, 0)), unfiled: lists.get(null) ?? [] };
}

function findNode(nodes: readonly MoveTreeNode[], id: string): MoveTreeNode | null {
  for (const n of nodes) {
    if (n.folder.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** The folders from a root down to `id`, or null when it isn't in the tree. */
function pathTo(nodes: readonly MoveTreeNode[], id: string): MoveTreeNode[] | null {
  for (const n of nodes) {
    if (n.folder.id === id) return [n];
    const rest = pathTo(n.children, id);
    if (rest) return [n, ...rest];
  }
  return null;
}

function walk(node: MoveTreeNode, visit: (n: MoveTreeNode) => void): void {
  visit(node);
  for (const c of node.children) walk(c, visit);
}

/**
 * The folders that count as ticked: a folder with no playlists anywhere
 * inside when it's ticked itself, any other folder when every playlist in it
 * is. Everything under a ticked folder counts as ticked, since it moves along.
 */
function fullFolders(tree: MoveTree, sel: MoveSelection): Set<string> {
  const full = new Set<string>();
  // Returns [ticked, holds a playlist somewhere inside].
  const visit = (n: MoveTreeNode): [boolean, boolean] => {
    const kids = n.children.map((c) => [c, ...visit(c)] as const);
    const hasContent = n.playlists.length > 0 || kids.some(([, , content]) => content);
    const isFull = hasContent
      ? n.playlists.every((p) => sel.playlistIds.has(p.id)) &&
        kids.every(([, kidFull, content]) => kidFull || !content)
      : sel.folderIds.has(n.folder.id);
    if (isFull) walk(n, (d) => full.add(d.folder.id));
    return [isFull, hasContent];
  };
  tree.roots.forEach(visit);
  return full;
}

function normalized(tree: MoveTree, sel: MoveSelection): MoveSelection {
  return { ...sel, folderIds: fullFolders(tree, sel) };
}

export function folderCheckState(tree: MoveTree, sel: MoveSelection, folderId: string): CheckState {
  const node = findNode(tree.roots, folderId);
  if (!node) return "unchecked";
  if (sel.folderIds.has(folderId)) return "checked";
  let any = false;
  walk(node, (n) => {
    if (sel.folderIds.has(n.folder.id) || n.playlists.some((p) => sel.playlistIds.has(p.id))) any = true;
  });
  return any ? "mixed" : "unchecked";
}

export function toggleFolder(tree: MoveTree, sel: MoveSelection, folderId: string): MoveSelection {
  const node = findNode(tree.roots, folderId);
  if (!node) return sel;
  const on = !sel.folderIds.has(folderId);
  const folderIds = new Set(sel.folderIds);
  const playlistIds = new Set(sel.playlistIds);
  walk(node, (n) => {
    if (on) folderIds.add(n.folder.id);
    else folderIds.delete(n.folder.id);
    for (const p of n.playlists) {
      if (on) playlistIds.add(p.id);
      else playlistIds.delete(p.id);
    }
  });
  return normalized(tree, { ...sel, folderIds, playlistIds });
}

export function togglePlaylist(tree: MoveTree, sel: MoveSelection, playlistId: string): MoveSelection {
  const playlistIds = new Set(sel.playlistIds);
  const folderIds = new Set(sel.folderIds);
  if (playlistIds.has(playlistId)) {
    playlistIds.delete(playlistId);
    // Its ticked folders stop being whole: the empty subfolders that were
    // ticked only because they came along go back to unticked too.
    const folderId = [...tree.unfiled, ...allPlaylists(tree)].find((p) => p.id === playlistId)?.folderId;
    const path = folderId ? pathTo(tree.roots, folderId) : null;
    const topTicked = path?.find((n) => sel.folderIds.has(n.folder.id));
    if (topTicked) walk(topTicked, (n) => folderIds.delete(n.folder.id));
  } else {
    playlistIds.add(playlistId);
  }
  return normalized(tree, { ...sel, folderIds, playlistIds });
}

function allPlaylists(tree: MoveTree): MovePlaylist[] {
  const out: MovePlaylist[] = [];
  for (const r of tree.roots) walk(r, (n) => out.push(...n.playlists));
  return out;
}

export function toggleGame(sel: MoveSelection, gameId: string): MoveSelection {
  const gameIds = new Set(sel.gameIds);
  if (gameIds.has(gameId)) gameIds.delete(gameId);
  else gameIds.add(gameId);
  return { ...sel, gameIds };
}

export function selectAll(preview: MovePreview): MoveSelection {
  return {
    folderIds: new Set(preview.folders.map((f) => f.id)),
    playlistIds: new Set(preview.playlists.map((p) => p.id)),
    gameIds: new Set(preview.games.map((g) => g.id)),
  };
}

/** Selects every playlist (and so every folder), leaving the games as they are. */
export function selectAllPlaylists(tree: MoveTree, preview: MovePreview, sel: MoveSelection): MoveSelection {
  return normalized(tree, {
    ...sel,
    folderIds: new Set(preview.folders.map((f) => f.id)),
    playlistIds: new Set(preview.playlists.map((p) => p.id)),
  });
}

export function clearPlaylists(sel: MoveSelection): MoveSelection {
  return { ...sel, folderIds: new Set(), playlistIds: new Set() };
}

export function selectAllGames(preview: MovePreview, sel: MoveSelection): MoveSelection {
  return { ...sel, gameIds: new Set(preview.games.map((g) => g.id)) };
}

export function clearGames(sel: MoveSelection): MoveSelection {
  return { ...sel, gameIds: new Set() };
}

/** Listed games that ticked playlists bring along. */
export function autoGameIds(preview: MovePreview, sel: MoveSelection): Set<string> {
  const listed = new Set(preview.games.map((g) => g.id));
  const ids = new Set<string>();
  for (const p of preview.playlists) {
    if (!sel.playlistIds.has(p.id)) continue;
    for (const id of p.matchIds) if (listed.has(id)) ids.add(id);
  }
  return ids;
}

/** Every game that would move or merge: ticked ones plus auto ones. */
export function movingGameIds(preview: MovePreview, sel: MoveSelection): Set<string> {
  const ids = autoGameIds(preview, sel);
  for (const id of sel.gameIds) ids.add(id);
  return ids;
}

export function isEverythingSelected(preview: MovePreview, sel: MoveSelection): boolean {
  const games = movingGameIds(preview, sel);
  return (
    preview.playlists.every((p) => sel.playlistIds.has(p.id)) &&
    preview.folders.every((f) => sel.folderIds.has(f.id)) &&
    preview.games.every((g) => games.has(g.id))
  );
}

/** The smallest request: top ticked folders, playlists outside them, games not brought by a playlist. */
export function toRequest(tree: MoveTree, preview: MovePreview, sel: MoveSelection): MoveRequest {
  const full = fullFolders(tree, sel);
  const folderIds: string[] = [];
  const inFull = new Set<string>();
  const visit = (n: MoveTreeNode, parentFull: boolean) => {
    const isFull = full.has(n.folder.id);
    if (isFull && !parentFull) folderIds.push(n.folder.id);
    if (isFull || parentFull) inFull.add(n.folder.id);
    for (const c of n.children) visit(c, isFull || parentFull);
  };
  tree.roots.forEach((r) => visit(r, false));

  const playlistIds = preview.playlists
    .filter((p) => sel.playlistIds.has(p.id) && !(p.folderId && inFull.has(p.folderId)))
    .map((p) => p.id);
  const auto = autoGameIds(preview, sel);
  const matchIds = preview.games.filter((g) => sel.gameIds.has(g.id) && !auto.has(g.id)).map((g) => g.id);
  return { matchIds, playlistIds, folderIds };
}

export interface MoveSummary {
  games: number;
  playlists: number;
  folders: number;
  /** Games brought by a ticked playlist. */
  autoGames: number;
  /** Games the club already has that will merge into its copy. */
  merges: number;
  /** Games the club already has that will move as a second copy. */
  secondCopies: number;
  /** Unticked playlists that use a moving game; they keep their clips. */
  stayingPlaylists: number;
  /** Ticked playlists with old sharing, which the move removes. */
  sharedPlaylists: number;
}

export function summarizeSelection(tree: MoveTree, preview: MovePreview, sel: MoveSelection): MoveSummary {
  const games = movingGameIds(preview, sel);
  const moving = preview.games.filter((g) => games.has(g.id));
  return {
    games: moving.length,
    playlists: preview.playlists.filter((p) => sel.playlistIds.has(p.id)).length,
    folders: fullFolders(tree, sel).size,
    autoGames: autoGameIds(preview, sel).size,
    merges: moving.filter((g) => g.duplicate?.mergeable).length,
    secondCopies: moving.filter((g) => g.duplicate && !g.duplicate.mergeable).length,
    stayingPlaylists: preview.playlists.filter(
      (p) => !sel.playlistIds.has(p.id) && p.matchIds.some((id) => games.has(id)),
    ).length,
    sharedPlaylists: preview.playlists.filter((p) => sel.playlistIds.has(p.id) && p.shared).length,
  };
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export function countNoun(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "3 games and 2 playlists", "1 game", "2 playlists". Folders only count when
 * nothing else moves (a move of empty folders); otherwise they come with
 * their playlists.
 */
export function moveItemsLabel(games: number, playlists: number, folders = 0): string {
  const parts: string[] = [];
  if (games > 0) parts.push(countNoun(games, "game", "games"));
  if (playlists > 0) parts.push(countNoun(playlists, "playlist", "playlists"));
  if (parts.length === 0 && folders > 0) parts.push(countNoun(folders, "folder", "folders"));
  return parts.length > 0 ? parts.join(" and ") : "Nothing selected";
}

export function moveConfirmTitle(summary: MoveSummary, club: string): string {
  return `Move ${moveItemsLabel(summary.games, summary.playlists, summary.folders)} to ${club}?`;
}

export function moveConfirmBody(club: string): string {
  return `They leave your personal space. In ${club}, only you see them until you share a playlist. You can't move them back, and if you leave ${club} they stay there.`;
}

/** Extra lines for the confirmation, only for what applies. */
export function moveConfirmNotes(summary: MoveSummary, club: string): string[] {
  const notes: string[] = [];
  if (summary.merges === 1) notes.push(`1 game is already in ${club}. Your clips join that copy.`);
  else if (summary.merges > 1) notes.push(`${summary.merges} games are already in ${club}. Your clips join those copies.`);
  if (summary.secondCopies === 1) notes.push(`1 game is also in ${club} but can't be merged, so ${club} gets a second copy.`);
  else if (summary.secondCopies > 1)
    notes.push(`${summary.secondCopies} games are also in ${club} but can't be merged, so ${club} gets second copies.`);
  if (summary.stayingPlaylists === 1)
    notes.push("1 playlist that stays in your personal space uses these games. It keeps its clips.");
  else if (summary.stayingPlaylists > 1)
    notes.push(`${summary.stayingPlaylists} playlists that stay in your personal space use these games. They keep their clips.`);
  if (summary.sharedPlaylists === 1) notes.push("Old sharing on 1 playlist is removed.");
  else if (summary.sharedPlaylists > 1) notes.push(`Old sharing on ${summary.sharedPlaylists} playlists is removed.`);
  return notes;
}

/** The badge on a game the club already has. */
export function duplicateLabel(dup: MoveDuplicate, club: string): { label: string; detail: string | null } {
  if (dup.mergeable) return { label: `Already in ${club} · Will be merged`, detail: null };
  const detail =
    dup.reason === "plays_differ"
      ? "The plays differ between the two copies"
      : dup.reason === "video_differs"
        ? "The copies use different video or sync"
        : dup.reason === "stats_source_differs"
          ? "The copies take their plays from different sources"
          : null;
  return { label: `Already in ${club} · Moves as a second copy`, detail };
}

export function moveErrorMessage(token: MoveErrorToken, club: string): string {
  switch (token) {
    case "license_locked":
      return `${club}'s license has expired. Renew it to move content there.`;
    case "not_staff":
      return `Only coaches and admins of ${club} can move content there.`;
    case "not_movable":
    case "demo_not_movable":
    case "folder_has_other_space_content":
      return "Some items changed since the list loaded. Reload it and try again.";
    case "too_many":
      return "Too many items for one move. Move them in smaller batches.";
    case "nothing_to_move":
      return "Select at least one game or playlist.";
    default:
      return "Content couldn't be moved. Nothing was changed.";
  }
}

/** "3 games and 2 playlists" for the success banner; merged games count as moved. */
export function moveResultLabel(result: MoveResult): string {
  return moveItemsLabel(result.gamesMoved + result.gamesMerged, result.playlistsMoved, result.foldersRemoved);
}
