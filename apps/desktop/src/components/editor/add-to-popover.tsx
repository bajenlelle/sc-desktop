import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Playlist } from "@/types/match";
import { Sentry } from "@/lib/sentry";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";

/**
 * "Add to another playlist": a portaled popover whose search field doubles
 * as the name of a playlist to create, same mechanics as the label picker.
 * With no other playlist it opens straight into its "type a name" state.
 */
export function AddToPopover({
  playlists,
  activePlaylistId,
  onAddToPlaylist,
  onCreatePlaylist,
  trigger,
}: {
  playlists: Playlist[];
  activePlaylistId: string | null;
  onAddToPlaylist: (playlist: Playlist) => Promise<void>;
  onCreatePlaylist: (name: string) => Promise<void>;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [addingId, setAddingId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const trimmed = search.trim();
  const q = trimmed.toLowerCase();
  const candidates = playlists.filter((pl) => !(activePlaylistId && pl.id === activePlaylistId));
  const options = candidates.filter((pl) => !q || pl.name.toLowerCase().includes(q));
  const exactMatch = candidates.some((pl) => pl.name.toLowerCase() === q);
  const showCreateRow = trimmed.length > 0 && !exactMatch;

  // The rows stay mounted until the add resolves, so without this guard a
  // double-click fires two overlapping adds of the same clips.
  async function handleAdd(pl: Playlist) {
    if (addingId) return;
    setAddingId(pl.id);
    try {
      await onAddToPlaylist(pl);
      setOpen(false);
    } catch (err) {
      console.error("[playlists] Failed to add clips to playlist:", err);
      Sentry.captureException(err);
      toast.error("Couldn't add the clips");
    } finally {
      setAddingId(null);
    }
  }

  async function handleCreate() {
    if (!showCreateRow || creating) return;
    setCreating(true);
    try {
      await onCreatePlaylist(trimmed);
      setOpen(false);
    } catch (err) {
      console.error("[playlists] Failed to create playlist from popover:", err);
      toast.error("Couldn't create playlist");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="p-2">
          <SearchField
            ref={inputRef}
            placeholder="Search or create…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && showCreateRow) {
                e.preventDefault();
                void handleCreate();
              }
            }}
          />
        </div>
        {options.length > 0 ? (
          <div className="max-h-60 overflow-y-auto px-1 pb-1">
            {options.map((pl) => (
              <button
                key={pl.id}
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 disabled:opacity-50 focus-visible:bg-fill-1"
                onClick={() => void handleAdd(pl)}
                disabled={addingId !== null}
              >
                {addingId === pl.id && <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />}
                <span className="min-w-0 flex-1 truncate">{pl.name}</span>
                <span className="text-xs nums text-muted-foreground">{pl.items.length}</span>
              </button>
            ))}
          </div>
        ) : (
          !showCreateRow && (
            <p className="px-3 pb-3 text-xs text-muted-foreground">Type a name to create a new playlist</p>
          )
        )}
        {showCreateRow && (
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 border-t border-separator px-3 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 disabled:opacity-50"
            onClick={() => void handleCreate()}
            disabled={creating}
          >
            {creating ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <Plus className="size-3.5 shrink-0 text-primary" />
            )}
            <span className="min-w-0 flex-1 truncate">
              Create &ldquo;<span className="font-medium">{trimmed}</span>&rdquo;
            </span>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
