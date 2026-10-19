"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updatePlaylist } from "@scoutable/shared/lib/playlists-db";
import type { Playlist } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

/**
 * Renaming a playlist from a list, where there is no title to click: one
 * field, Return saves, Escape cancels. Writes the name itself and hands the
 * result to the caller for its local state. (The editor renames inline.)
 */
export function RenamePlaylistDialog({
  playlist,
  onClose,
  onRenamed,
}: {
  /** The playlist to rename; null keeps the dialog closed. */
  playlist: Playlist | null;
  onClose: () => void;
  onRenamed: (id: string, name: string) => void;
}) {
  // What the user has typed, for the playlist it was typed for: another
  // playlist opens on its own current name, with no state to sync.
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const name = playlist ? (draft?.id === playlist.id ? draft.name : playlist.name) : "";
  const setName = (next: string) => {
    if (playlist) setDraft({ id: playlist.id, name: next });
  };

  const trimmed = name.trim();
  const unchanged = !!playlist && trimmed === playlist.name;

  async function save() {
    if (!playlist || !trimmed || saving) return;
    if (unchanged) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updatePlaylist(createClient(), playlist.id, { name: trimmed });
      trackEvent("playlist_renamed", { playlist_id: playlist.id, origin: "web" });
      onRenamed(playlist.id, trimmed);
    } catch (e) {
      toast.error("Couldn't rename the playlist", { description: (e as Error).message });
      return;
    } finally {
      setSaving(false);
    }
    onClose();
  }

  return (
    <Dialog open={playlist !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename playlist</DialogTitle>
            <DialogDescription className="sr-only">Type a new name for the playlist.</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Playlist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            maxLength={120}
            disabled={saving}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !trimmed}>
              {saving && <Loader2 className="animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
