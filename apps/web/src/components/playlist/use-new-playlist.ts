"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createPlaylist } from "@scoutable/shared/lib/playlists-db";
import { useAuth } from "@/components/auth-context";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

/** The name every new playlist starts with; the editor opens on it, ready to be renamed. */
export const NEW_PLAYLIST_NAME = "New playlist";

/**
 * "New playlist" wherever it appears (Home, the Playlists list, their
 * hotkey): creates the playlist in the active space and opens it in the
 * editor with the title ready to rename (`?rename=1`, which the editor
 * reads). One at a time.
 */
export function useNewPlaylist(): { createNew: () => Promise<void>; creating: boolean } {
  const router = useRouter();
  const { activeOrgId } = useAuth();
  const [creating, setCreating] = useState(false);

  const createNew = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const playlist = await createPlaylist(createClient(), NEW_PLAYLIST_NAME, undefined, activeOrgId ?? undefined);
      trackEvent("playlist_created", { origin: "web", playlist_id: playlist.id });
      router.push(`/playlists/${encodeURIComponent(playlist.id)}?rename=1`);
    } catch (e) {
      toast.error("Couldn't create the playlist", { description: (e as Error).message });
    } finally {
      setCreating(false);
    }
  }, [activeOrgId, creating, router]);

  return { createNew, creating };
}
