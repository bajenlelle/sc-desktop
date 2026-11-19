/**
 * Undo and redo for the playlists sidebar: renaming a playlist or a folder,
 * and moving one into a folder (by drag or by menu). Deletes and creates are
 * not recorded.
 *
 * The page keeps two kinds of history: the rows of each playlist
 * (playlist-history.ts, one per playlist) and this one for the sidebar. They
 * interleave through one counter: every edit on the page is stamped with the
 * next `seq`.
 * - Undo (⌘Z) takes whichever top of `past` has the higher `seq`: the most
 *   recent edit across both.
 * - Redo (⇧⌘Z) takes whichever top of `future` has the lower `seq`: the edit
 *   undone last, because undo runs in falling `seq`.
 * - A new edit on either side drops the other side's `future` (dropFuture).
 * - A toast's own Undo steps only its own history, never through the chooser.
 *
 * A step only applies while the target still holds the value the edit left
 * (undo) or found (redo), and a move only into a folder that still exists and
 * would not put a folder inside itself. Otherwise it undoes nothing, and the
 * edit is forgotten from both stacks. Pure, so the page and the tests share it.
 */
import { pushEdit, takeRedo, takeUndo, type Edit, type History } from "./playlist-history";

export interface SidebarEdit extends Edit<string | null> {
  seq: number;
  target: "playlist" | "folder";
  id: string;
  /** "name", or "parent": a playlist's folder / a folder's parent folder; null = top level. */
  field: "name" | "parent";
}

/** Adds a sidebar edit; one that kept the value is not one. */
export function recordSidebarEdit(history: History<SidebarEdit>, edit: SidebarEdit): History<SidebarEdit> {
  if (edit.before === edit.after) return history;
  return pushEdit(history, edit);
}

/** Which history ⌘Z (undo) or ⇧⌘Z (redo) steps next; an edit without a `seq` counts as 0. */
export function nextHistoryStep(
  direction: "undo" | "redo",
  rows: History<{ seq?: number }>,
  sidebar: History<{ seq?: number }>,
): "rows" | "sidebar" | null {
  const stack = direction === "undo" ? "past" : "future";
  const r = rows[stack][rows[stack].length - 1];
  const s = sidebar[stack][sidebar[stack].length - 1];
  if (!r && !s) return null;
  if (!r) return "sidebar";
  if (!s) return "rows";
  const rs = r.seq ?? 0;
  const ss = s.seq ?? 0;
  if (direction === "undo") return rs > ss ? "rows" : "sidebar";
  return rs < ss ? "rows" : "sidebar";
}

/**
 * Why a step did nothing: the target was renamed or moved since ("changed"),
 * deleted ("gone"), the folder it would go into was deleted ("place_gone"), or
 * the folder would land inside itself ("cycle").
 */
export type SidebarBlock = "changed" | "gone" | "place_gone" | "cycle";

export type SidebarStep =
  | { history: History<SidebarEdit>; edit: SidebarEdit; to: string | null }
  | { history: History<SidebarEdit>; edit: SidebarEdit; blocked: SidebarBlock };

/** The history without `edit`, on either stack. */
function forget(history: History<SidebarEdit>, edit: SidebarEdit): History<SidebarEdit> {
  return { past: history.past.filter((e) => e !== edit), future: history.future.filter((e) => e !== edit) };
}

/**
 * `current` reads the target's value now: undefined when the playlist or
 * folder no longer exists. For a move into a folder, `placeExists` says
 * whether that folder still exists, and `wouldNest(folderId, parentId)`
 * whether a folder would land inside itself; left out, they don't block.
 */
export function takeSidebarStep(
  history: History<SidebarEdit>,
  direction: "undo" | "redo",
  current: (edit: SidebarEdit) => string | null | undefined,
  placeExists?: (folderId: string) => boolean,
  wouldNest?: (folderId: string, parentId: string) => boolean,
): SidebarStep | null {
  const stack = direction === "undo" ? history.past : history.future;
  const edit = stack[stack.length - 1];
  if (!edit) return null;
  const blocked = (why: SidebarBlock): SidebarStep => ({ history: forget(history, edit), edit, blocked: why });
  const expected = direction === "undo" ? edit.after : edit.before;
  const now = current(edit);
  if (now !== expected) return blocked(now === undefined ? "gone" : "changed");
  const to = direction === "undo" ? edit.before : edit.after;
  if (edit.field === "parent" && to !== null) {
    if (placeExists && !placeExists(to)) return blocked("place_gone");
    if (edit.target === "folder" && wouldNest?.(edit.id, to)) return blocked("cycle");
  }
  const taken = direction === "undo" ? takeUndo(history)! : takeRedo(history)!;
  return { history: taken.history, edit, to };
}

/**
 * The history after a step whose save failed: as it was before the step when
 * nothing was stepped or recorded since (`now` is still the step's history),
 * so the next ⌘Z tries the same edit again; else `now` without the edit.
 */
export function failedSidebarStep(
  now: History<SidebarEdit>,
  prior: History<SidebarEdit>,
  step: { history: History<SidebarEdit>; edit: SidebarEdit },
): History<SidebarEdit> {
  return now === step.history ? prior : forget(now, step.edit);
}
