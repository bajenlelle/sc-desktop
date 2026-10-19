/**
 * The playlist editor's edits as pure functions over a Playlist: what the
 * web editor applies optimistically before the row writes land (and rolls
 * back when they don't). Order, offsets, notes, cards and removal with undo
 * all live here, so they are tested once and read the same on every surface.
 */
import type { Playlist, PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../types/match";
import { isClipItem } from "../types/match";
import { normalizeGroups } from "./clip-groups";
import { playlistRolls, type RollPair } from "./clip-timing";

/** The key an item goes by in the editor: `<matchId>:<eventId>` for a clip, `text:<id>` for a card. */
export function itemKey(item: PlaylistItem): string {
  return isClipItem(item) ? `${item.matchId}:${item.eventId}` : `text:${item.id}`;
}

/** The pre-roll is held to 0–30 s and the post-roll to 0–60 s, in whole seconds, as the desktop does. */
export const MAX_PRE_ROLL_SECONDS = 30;
export const MAX_POST_ROLL_SECONDS = 60;

export function clampRolls(pre: number, post: number): RollPair {
  const whole = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
  return { pre: whole(pre, MAX_PRE_ROLL_SECONDS), post: whole(post, MAX_POST_ROLL_SECONDS) };
}

/**
 * The pair to save before the first per-clip offset is written to a playlist
 * that never saved one: offsets are relative to the pair, so the pair must
 * stop following the app default from then on. Null when it is saved already.
 */
export function pinnedPair(playlist: Pick<Playlist, "preRoll" | "postRoll">): RollPair | null {
  if (playlist.preRoll !== undefined && playlist.postRoll !== undefined) return null;
  return playlistRolls(playlist);
}

function mapItems(playlist: Playlist, fn: (item: PlaylistItem) => PlaylistItem): Playlist {
  return { ...playlist, items: playlist.items.map(fn) };
}

const hundredths = (n: number) => Math.round(n * 100) / 100;

/** The clip under `key` with new offsets (hundredths; a zero offset is dropped). */
export function withClipOffsets(playlist: Playlist, key: string, offsets: { preRollOffset: number; postRollOffset: number }): Playlist {
  return mapItems(playlist, (item) => {
    if (!isClipItem(item) || itemKey(item) !== key) return item;
    const next: PlaylistClipItem = { ...item };
    const pre = hundredths(offsets.preRollOffset);
    const post = hundredths(offsets.postRollOffset);
    if (pre === 0) delete next.preRollOffset;
    else next.preRollOffset = pre;
    if (post === 0) delete next.postRollOffset;
    else next.postRollOffset = post;
    return next;
  });
}

/** The clip under `key` with its note set, or cleared by an empty string. */
export function withNote(playlist: Playlist, key: string, note: string): Playlist {
  return mapItems(playlist, (item) => {
    if (!isClipItem(item) || itemKey(item) !== key) return item;
    const next: PlaylistClipItem = { ...item };
    const trimmed = note.trim();
    if (trimmed) next.note = note;
    else delete next.note;
    return next;
  });
}

/** The clip under `key` without its uploaded file (a trim makes the cut stale; the server cuts it again). */
export function withoutShippedFile(playlist: Playlist, key: string): Playlist {
  return mapItems(playlist, (item) => {
    if (!isClipItem(item) || itemKey(item) !== key || !item.r2Url) return item;
    const next: PlaylistClipItem = { ...item };
    delete next.r2Url;
    return next;
  });
}

export function withCardText(playlist: Playlist, cardId: string, text: string): Playlist {
  return mapItems(playlist, (item) => (!isClipItem(item) && item.id === cardId ? { ...item, text } : item));
}

export function withCardDuration(playlist: Playlist, cardId: string, durationSeconds: number): Playlist {
  const d = Math.min(30, Math.max(1, Math.round(Number.isFinite(durationSeconds) ? durationSeconds : 5)));
  return mapItems(playlist, (item) => (!isClipItem(item) && item.id === cardId ? { ...item, durationSeconds: d } : item));
}

/** The card inserted before the item under `beforeKey`, or at the end when that item is gone or null. */
export function insertCardAt(playlist: Playlist, card: PlaylistTextCard, beforeKey: string | null): Playlist {
  const items = [...playlist.items];
  const at = beforeKey === null ? -1 : items.findIndex((i) => itemKey(i) === beforeKey);
  if (at < 0) items.push(card);
  else items.splice(at, 0, card);
  return { ...playlist, items };
}

/** New clips appended, those already in the playlist left out. */
export function appendClips(playlist: Playlist, clips: readonly PlaylistClipItem[]): { playlist: Playlist; added: PlaylistClipItem[] } {
  const present = new Set(playlist.items.map(itemKey));
  const added: PlaylistClipItem[] = [];
  for (const clip of clips) {
    const key = itemKey(clip);
    if (present.has(key)) continue;
    present.add(key);
    added.push(clip);
  }
  return { playlist: { ...playlist, items: [...playlist.items, ...added] }, added };
}

/** An item that was removed, with where it sat, so Undo can put it back. */
export interface RemovedItem {
  index: number;
  item: PlaylistItem;
}

/**
 * The playlist without the items under `keys`; groups a removal broke are
 * dissolved (normalizeGroups). The removed items keep their indices for Undo.
 */
export function removeKeys(playlist: Playlist, keys: ReadonlySet<string>): { playlist: Playlist; removed: RemovedItem[] } {
  const removed: RemovedItem[] = [];
  const kept: PlaylistItem[] = [];
  playlist.items.forEach((item, index) => {
    if (keys.has(itemKey(item))) removed.push({ index, item });
    else kept.push(item);
  });
  return { playlist: { ...playlist, items: normalizeGroups(kept) }, removed };
}

/** The removed items back where they were, in order, so an Undo restores the list exactly. */
export function restoreRemoved(playlist: Playlist, removed: readonly RemovedItem[]): Playlist {
  const items = [...playlist.items];
  for (const r of [...removed].sort((a, b) => a.index - b.index)) {
    items.splice(Math.min(r.index, items.length), 0, r.item);
  }
  return { ...playlist, items };
}

/** The clips without an uploaded file. */
export function unshippedClips(playlist: Playlist): PlaylistClipItem[] {
  return playlist.items.filter((i): i is PlaylistClipItem => isClipItem(i) && !i.r2Url);
}

/** The clips whose game has no cloud copy the owner can cut from: recipients will not see them until the game is uploaded. */
export function noCopyClips(playlist: Playlist, readyMatchIds: ReadonlySet<string>): PlaylistClipItem[] {
  return playlist.items.filter((i): i is PlaylistClipItem => isClipItem(i) && !readyMatchIds.has(i.matchId));
}

/**
 * The display gap a block of rows lands in when the keyboard moves it one
 * slot up (-1) or down (+1): before the row above the block, or after the
 * row below it. Null when the block is already at that end, or when its
 * rows are not shown. The block is the rows that travel together
 * (dragBlockKeys), contiguous or not: the gap is counted from its first or
 * last row.
 */
export function nudgeGap(order: readonly string[], blockKeys: readonly string[], direction: -1 | 1): number | null {
  const block = new Set(blockKeys);
  let first = -1;
  let last = -1;
  order.forEach((key, i) => {
    if (!block.has(key)) return;
    if (first === -1) first = i;
    last = i;
  });
  if (first === -1) return null;
  if (direction < 0) return first === 0 ? null : first - 1;
  return last === order.length - 1 ? null : last + 2;
}

/** The games the playlist's clips come from, in order of first appearance. */
export function playlistMatchIds(playlist: Playlist): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of playlist.items) {
    if (!isClipItem(item) || seen.has(item.matchId)) continue;
    seen.add(item.matchId);
    out.push(item.matchId);
  }
  return out;
}
