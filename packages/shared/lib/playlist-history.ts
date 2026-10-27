/**
 * Undo, redo and the clipboard for a playlist's rows: which clips and cards
 * it holds, in what order, in which groups. ⌘Z / ⇧⌘Z step through edits of
 * that shape (remove, reorder, group, add, paste, cut); a clip's own
 * settings (trim, note, labels, crop) are not part of it.
 *
 * An edit is two snapshots of the rows. Undo goes back to `before` as the
 * rows are NOW (materialize): a note written after the edit stays, and the
 * server is brought there with itemsDiff (delete what came in, put back what
 * went, then save the order). Pure, so the editor and the tests share it.
 *
 * The stack itself (pushEdit, takeUndo, takeRedo) takes any kind of edit: the
 * scouting report keeps one of its own (recordReportEdit in report-draft.ts).
 */
import type { PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../types/match";
import { isClipItem } from "../types/match";
import { itemKey } from "./playlist-edits";

export const HISTORY_LIMIT = 50;

export interface Edit<S> {
  /** "Remove 3 items", for the menu and the toast. */
  label: string;
  before: S;
  after: S;
}

export type ItemsEdit = Edit<PlaylistItem[]>;

export interface History<E = ItemsEdit> {
  past: E[];
  future: E[];
}

export function emptyHistory<E = ItemsEdit>(): History<E> {
  return { past: [], future: [] };
}

/** The rows, their order and their groups: what an edit changes. */
function shape(items: readonly PlaylistItem[]): string {
  return items.map((i) => `${itemKey(i)}|${i.groupId ?? ""}`).join("\n");
}

/** Adds an edit, dropping what could be redone and the oldest past the limit. */
export function pushEdit<E>(history: History<E>, edit: E): History<E> {
  const past = [...history.past, edit];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, future: [] };
}

/** Adds a playlist edit; one that changed nothing is not one. */
export function recordEdit(history: History, edit: ItemsEdit): History {
  if (shape(edit.before) === shape(edit.after)) return history;
  return pushEdit(history, edit);
}

export function takeUndo<E>(history: History<E>): { history: History<E>; edit: E } | null {
  const edit = history.past[history.past.length - 1];
  if (!edit) return null;
  return { history: { past: history.past.slice(0, -1), future: [...history.future, edit] }, edit };
}

export function takeRedo<E>(history: History<E>): { history: History<E>; edit: E } | null {
  const edit = history.future[history.future.length - 1];
  if (!edit) return null;
  return { history: { past: [...history.past, edit], future: history.future.slice(0, -1) }, edit };
}

/**
 * The snapshot's rows, order and groups, each row as it is now where it
 * still exists (a later note or trim stays), else as the snapshot had it.
 */
export function materialize(snapshot: readonly PlaylistItem[], now: readonly PlaylistItem[]): PlaylistItem[] {
  const current = new Map(now.map((i) => [itemKey(i), i]));
  return snapshot.map((s) => {
    const base = current.get(itemKey(s)) ?? s;
    if (base.groupId === s.groupId) return base;
    const { groupId: _g, ...rest } = base;
    return (s.groupId ? { ...rest, groupId: s.groupId } : rest) as PlaylistItem;
  });
}

export interface ItemsDiff {
  removedClips: { matchId: string; eventId: number }[];
  removedTextIds: string[];
  addedClips: PlaylistClipItem[];
  addedText: PlaylistTextCard[];
}

/** What the server must delete and put back to go from `from` to `to` (the order is saved after). */
export function itemsDiff(from: readonly PlaylistItem[], to: readonly PlaylistItem[]): ItemsDiff {
  const fromKeys = new Set(from.map(itemKey));
  const toKeys = new Set(to.map(itemKey));
  const diff: ItemsDiff = { removedClips: [], removedTextIds: [], addedClips: [], addedText: [] };
  for (const i of from) {
    if (toKeys.has(itemKey(i))) continue;
    if (isClipItem(i)) diff.removedClips.push({ matchId: i.matchId, eventId: i.eventId });
    else diff.removedTextIds.push(i.id);
  }
  for (const i of to) {
    if (fromKeys.has(itemKey(i))) continue;
    if (isClipItem(i)) diff.addedClips.push(i);
    else diff.addedText.push(i);
  }
  return diff;
}

/**
 * Copied rows into a playlist at `index`: clips it already holds are skipped
 * (a clip is in a playlist once), cards are pasted as copies with new ids.
 * Pasted rows join no group, and a clip leaves its hosted file behind: the
 * target cuts its own, at its own clip length.
 */
export function pasteItems(
  items: readonly PlaylistItem[],
  clipboard: readonly PlaylistItem[],
  index: number,
  newId: () => string = () => crypto.randomUUID(),
): { items: PlaylistItem[]; pasted: PlaylistItem[] } {
  const present = new Set(items.filter(isClipItem).map(itemKey));
  const pasted: PlaylistItem[] = [];
  for (const c of clipboard) {
    const { groupId: _g, ...rest } = c;
    if (isClipItem(c)) {
      const key = itemKey(c);
      if (present.has(key)) continue;
      present.add(key);
      const { r2Url: _f, ...clipRest } = rest as PlaylistClipItem;
      pasted.push(clipRest as PlaylistClipItem);
    } else {
      pasted.push({ ...(rest as PlaylistTextCard), id: newId() });
    }
  }
  if (pasted.length === 0) return { items: items as PlaylistItem[], pasted };
  const at = Math.max(0, Math.min(index, items.length));
  return { items: [...items.slice(0, at), ...pasted, ...items.slice(at)], pasted };
}

/**
 * Where a paste lands: after the focused row, past the end of its group (a
 * paste never splits one), else at the end.
 */
export function pasteIndexAfter(items: readonly PlaylistItem[], focusKey: string | null): number {
  const at = focusKey === null ? -1 : items.findIndex((i) => itemKey(i) === focusKey);
  if (at < 0) return items.length;
  let end = at + 1;
  const group = items[at].groupId;
  while (group && end < items.length && items[end].groupId === group) end++;
  return end;
}
