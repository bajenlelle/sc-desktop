/**
 * The playlist editor's edits as pure functions over a Playlist. Only the
 * item key lives here on main; the web editor's edits (order, offsets,
 * notes, cards, removal with undo) join it from the cloud-videos branch.
 */
import type { PlaylistItem } from "../types/match";
import { isClipItem } from "../types/match";

/** The key an item goes by in the editor: `<matchId>:<eventId>` for a clip, `text:<id>` for a card. */
export function itemKey(item: PlaylistItem): string {
  return isClipItem(item) ? `${item.matchId}:${item.eventId}` : `text:${item.id}`;
}
