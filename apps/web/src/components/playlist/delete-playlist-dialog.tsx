"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deletePlaylist } from "@scoutable/shared/lib/playlists-db";
import type { Playlist } from "@scoutable/shared/types/match";
import { isPlaylistShared, playlistClipCount } from "@/components/playlist/playlist-row";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

/**
 * The one confirmation around playlists: deleting cannot be undone, so it
 * says what goes with the playlist and offers the destructive action last.
 * Deletes the row itself and hands the id to the caller for its local
 * state.
 */
export function DeletePlaylistDialog({
  playlist,
  onClose,
  onDeleted,
}: {
  /** The playlist to delete; null keeps the dialog closed. */
  playlist: Playlist | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const clips = playlist ? playlistClipCount(playlist) : 0;
  const shared = !!playlist && isPlaylistShared(playlist);

  async function remove() {
    if (!playlist || deleting) return;
    setDeleting(true);
    try {
      await deletePlaylist(createClient(), playlist.id);
      trackEvent("playlist_deleted", { playlist_id: playlist.id, clips, origin: "web" });
      onDeleted(playlist.id);
    } catch (e) {
      toast.error("Couldn't delete the playlist", { description: (e as Error).message });
      return;
    } finally {
      setDeleting(false);
    }
    onClose();
  }

  const what =
    clips === 0 ? "It has no clips yet." : clips === 1 ? "Its clip is removed from the playlist." : `Its ${clips} clips are removed from the playlist.`;

  return (
    <Dialog open={playlist !== null} onOpenChange={(open) => !open && !deleting && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete “{playlist?.name}”?</DialogTitle>
          <DialogDescription>
            {what} The games stay in your Library.{shared ? " The people it is shared with lose access." : ""} This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
            {deleting && <Loader2 className="animate-spin" />}
            Delete playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
