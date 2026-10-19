/**
 * The playlist editor's edits as pure functions over a Playlist: what the
 * web editor applies optimistically before the row writes land (and rolls
 * back when they don't). Order, offsets, notes, cards and removal with undo
 * all live here, so they are tested once and read the same on every surface.
 */
import type { Playlist, PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../types/match";
import { isClipItem } from "../types/match";
import { moveBlock, normalizeGroups } from "./clip-groups";
import { playlistRolls, rebaseOffsets, type RollPair } from "./clip-timing";
import type { StatsCardSpec } from "./stats-card";

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

/** The card under `cardId` drawn from a stats card spec, or (null) back to a plain text card. */
export function withCardSpec(playlist: Playlist, cardId: string, card: StatsCardSpec | null): Playlist {
  return mapItems(playlist, (item) => {
    if (isClipItem(item) || item.id !== cardId) return item;
    const next: PlaylistTextCard = { ...item };
    if (card) next.card = card;
    else delete next.card;
    return next;
  });
}

/**
 * The card inserted before the item under `beforeKey`, or at the end when
 * that item is gone or null. Never inside a group: a key in the middle of a
 * group's run puts the card above the whole run, as the desktop does.
 */
export function insertCardAt(playlist: Playlist, card: PlaylistTextCard, beforeKey: string | null): Playlist {
  const items = [...playlist.items];
  let at = beforeKey === null ? -1 : items.findIndex((i) => itemKey(i) === beforeKey);
  if (at < 0) {
    items.push(card);
  } else {
    const gid = items[at].groupId;
    if (gid) while (at > 0 && items[at - 1].groupId === gid) at--;
    items.splice(at, 0, card);
  }
  return { ...playlist, items };
}

// ---------------------------------------------------------------------------
// Groups: items locked together so they move as one block
// ---------------------------------------------------------------------------

/**
 * The picked items made one group. Groups are atomic, so a selection that
 * touches a group takes that whole group along; the members are pulled
 * together at the first member's place (the rest follow it in their order),
 * and a group this leaves with one member dissolves (normalizeGroups).
 * `members` are the grouped keys in their new order. Null when fewer than
 * two items are picked, or when they already are exactly this one group.
 */
export function groupItems(
  playlist: Playlist,
  keys: ReadonlySet<string>,
  groupId: string,
): { playlist: Playlist; members: string[] } | null {
  const order = playlist.items.map(itemKey);
  if (order.filter((k) => keys.has(k)).length < 2) return null;
  const absorbed = new Set<string>();
  playlist.items.forEach((item, i) => {
    if (item.groupId && keys.has(order[i])) absorbed.add(item.groupId);
  });
  const memberIndices: number[] = [];
  playlist.items.forEach((item, i) => {
    if (keys.has(order[i]) || (item.groupId !== undefined && absorbed.has(item.groupId))) memberIndices.push(i);
  });
  // Already one whole, contiguous group: nothing to do.
  const only = playlist.items[memberIndices[0]].groupId;
  const groupTotal = only ? playlist.items.filter((i) => i.groupId === only).length : 0;
  const contiguous = memberIndices.every((idx, n) => idx === memberIndices[0] + n);
  if (only && contiguous && groupTotal === memberIndices.length && memberIndices.every((i) => playlist.items[i].groupId === only)) {
    return null;
  }
  const memberKeys = new Set(memberIndices.map((i) => order[i]));
  // moveBlock to the first member's own gap keeps it in place and pulls the rest up behind it.
  const moved = moveBlock(playlist.items, memberIndices, memberIndices[0]);
  const items = normalizeGroups(moved.map((item) => (memberKeys.has(itemKey(item)) ? { ...item, groupId } : item)));
  return { playlist: { ...playlist, items }, members: items.map(itemKey).filter((k) => memberKeys.has(k)) };
}

/** The group under `groupId` taken apart; its items stay where they are. `count` is how many it held. */
export function ungroupItems(playlist: Playlist, groupId: string): { playlist: Playlist; count: number } {
  let count = 0;
  const items = playlist.items.map((item) => {
    if (item.groupId !== groupId) return item;
    count++;
    const { groupId: _g, ...rest } = item;
    return rest as PlaylistItem;
  });
  return { playlist: count > 0 ? { ...playlist, items } : playlist, count };
}

export type SelectionGroupAction = { kind: "group" } | { kind: "ungroup"; groupId: string; count: number } | null;

/**
 * What the selection bar offers for the picked items: Ungroup when they all
 * sit in one group (a group is atomic, so a part of it stands for the
 * whole), Group when two or more are picked, else nothing.
 */
export function selectionGroupAction(playlist: Playlist, keys: ReadonlySet<string>): SelectionGroupAction {
  const picked = playlist.items.filter((item) => keys.has(itemKey(item)));
  if (picked.length === 0) return null;
  const gid = picked[0].groupId;
  if (gid && picked.every((item) => item.groupId === gid)) {
    return { kind: "ungroup", groupId: gid, count: playlist.items.filter((item) => item.groupId === gid).length };
  }
  return picked.length >= 2 ? { kind: "group" } : null;
}

/**
 * `current` with the order and the groups of `previous` put back: what a
 * failed reorder or (un)group write leaves on the server, kept with every
 * other edit made since (a note, a trim). Items only `current` has (added
 * meanwhile) keep their order after the rest; items it no longer has stay
 * gone.
 */
export function restoreStructure(current: Playlist, previous: Playlist): Playlist {
  const byKey = new Map(current.items.map((item) => [itemKey(item), item]));
  const items: PlaylistItem[] = [];
  for (const old of previous.items) {
    const key = itemKey(old);
    const now = byKey.get(key);
    if (!now) continue;
    byKey.delete(key);
    if (now.groupId === old.groupId) {
      items.push(now);
    } else if (old.groupId) {
      items.push({ ...now, groupId: old.groupId });
    } else {
      const { groupId: _g, ...rest } = now;
      items.push(rest as PlaylistItem);
    }
  }
  items.push(...byKey.values());
  return { ...current, items: normalizeGroups(items) };
}

// ---------------------------------------------------------------------------
// Copying clips to another playlist
// ---------------------------------------------------------------------------

/**
 * The clips under `keys` as copies for `target`, in this playlist's order:
 * cards stay behind, clips the target already has are left out, groups and
 * uploaded files don't travel, notes and pans do, and each clip keeps its
 * length (its offsets move onto the target's pair).
 */
export function clipsForCopy(source: Playlist, keys: ReadonlySet<string>, target: Playlist): PlaylistClipItem[] {
  const present = new Set(target.items.filter(isClipItem).map(itemKey));
  const from = playlistRolls(source);
  const to = playlistRolls(target);
  const out: PlaylistClipItem[] = [];
  for (const item of source.items) {
    if (!isClipItem(item)) continue;
    const key = itemKey(item);
    if (!keys.has(key) || present.has(key)) continue;
    present.add(key);
    const { groupId: _g, r2Url: _r, preRollOffset: _pre, postRollOffset: _post, ...rest } = item;
    const o = rebaseOffsets(item, from, to);
    out.push({
      ...rest,
      ...(o.preRollOffset !== 0 ? { preRollOffset: o.preRollOffset } : {}),
      ...(o.postRollOffset !== 0 ? { postRollOffset: o.postRollOffset } : {}),
    });
  }
  return out;
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
