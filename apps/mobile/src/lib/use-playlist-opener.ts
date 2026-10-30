import { useCallback } from "react";
import { router } from "expo-router";
import { clipViewKey } from "@scoutable/shared/lib/clip-views-db";
import { trackEvent } from "@/lib/analytics";
import { playableClips, usePlaylists } from "@/lib/playlists-store";

/**
 * Opening a playlist from a list, the sidebar's Recent rows or the floating
 * pill: from its start, or from the first clip the player hasn't watched.
 * One place for both, so `playlist_opened` is sent the same way everywhere.
 */
export function usePlaylistOpener() {
  const { allPlaylists, clipViews } = usePlaylists();

  const openPlaylist = useCallback((id: string) => {
    trackEvent("playlist_opened", { playlist_id: id, resumed: false });
    router.push(`/playlists/${id}`);
  }, []);

  const resumePlaylist = useCallback(
    (id: string) => {
      trackEvent("playlist_opened", { playlist_id: id, resumed: true });
      const pl = allPlaylists.find((p) => p.id === id);
      const firstUnwatched = pl
        ? playableClips(pl).find((c) => !clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId)))
        : undefined;
      if (firstUnwatched) {
        router.push(`/playlists/${id}?resume=${encodeURIComponent(`${firstUnwatched.matchId}:${firstUnwatched.eventId}`)}`);
      } else {
        router.push(`/playlists/${id}`);
      }
    },
    [allPlaylists, clipViews],
  );

  return { openPlaylist, resumePlaylist };
}
