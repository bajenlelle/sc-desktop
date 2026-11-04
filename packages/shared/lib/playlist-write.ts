/**
 * How a playlist's rows reach the server. The editor shows a change at once
 * and saves it through writePlaylistItems: what left is deleted, what came
 * (back) is put in with its settings and hosted file, then the order and the
 * groups are saved for the whole list. appendClips adds clips a coach picked
 * for a playlist that may already hold some of them. Pure orchestration over
 * playlists-db, so any host (the desktop, a script, an agent) writes the same
 * way.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaylistClipItem, PlaylistItem } from "../types/match";
import { isClipItem } from "../types/match";
import { itemKey } from "./playlist-edits";
import { itemsDiff, type ItemsDiff } from "./playlist-history";
import { addClips, insertTextCard, removeClips, reorderItems } from "./playlists-db";

/**
 * Brings the server from `from` to `to`: rows deleted, rows put back with
 * their settings and hosted files, then the order and the groups. Returns
 * what changed.
 */
export async function writePlaylistItems(
  sb: SupabaseClient,
  playlistId: string,
  from: readonly PlaylistItem[],
  to: readonly PlaylistItem[],
): Promise<ItemsDiff> {
  const d = itemsDiff(from, to);
  if (d.removedClips.length > 0 || d.removedTextIds.length > 0) await removeClips(sb, playlistId, d.removedClips, d.removedTextIds);
  if (d.addedClips.length > 0) await addClips(sb, playlistId, d.addedClips, 0, { restore: true });
  for (const t of d.addedText) await insertTextCard(sb, playlistId, t.id, t.text, t.durationSeconds, 0, t.card);
  await reorderItems(sb, playlistId, to as PlaylistItem[]);
  return d;
}

/**
 * Adds clips to the end of a playlist: a clip it already holds, or one given
 * twice, is added once; copies never carry group membership into the target.
 * Returns the clips that were added.
 */
export async function appendClips(
  sb: SupabaseClient,
  playlist: { id: string; items: readonly PlaylistItem[] },
  clips: readonly PlaylistClipItem[],
): Promise<PlaylistClipItem[]> {
  const present = new Set(playlist.items.filter(isClipItem).map(itemKey));
  const fresh: PlaylistClipItem[] = [];
  for (const c of clips) {
    const key = itemKey(c);
    if (present.has(key)) continue;
    present.add(key);
    const { groupId: _g, ...clean } = c;
    fresh.push(clean as PlaylistClipItem);
  }
  if (fresh.length === 0) return [];
  await addClips(sb, playlist.id, fresh, playlist.items.length);
  return fresh;
}
