/**
 * Announced on the window when a playlist is created, gets clips or is shared,
 * from any page (the Playlists page, the game view's Collect, Shared playlists),
 * so whatever is mounted elsewhere, like the sidebar's Getting started card,
 * can look again.
 */
export const PLAYLISTS_CHANGED = "playlists-changed";

export function announcePlaylistsChanged(): void {
  window.dispatchEvent(new CustomEvent(PLAYLISTS_CHANGED));
}
