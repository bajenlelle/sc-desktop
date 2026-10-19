"use client";

import * as React from "react";
import { ListVideo, Loader2, Plus } from "lucide-react";
import type { Playlist } from "@scoutable/shared/types/match";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";

/** A playlist clips can be copied into, as the popover lists it. */
export interface AddToCandidate {
  playlist: Playlist;
  /** Where it lives ("Season 25/26 / Scouting"); null at the top level. */
  path: string | null;
  clipCount: number;
}

export interface AddToProps {
  /** The user's other playlists in the space; null while they load. */
  candidates: readonly AddToCandidate[] | null;
  /** How many clips are going. */
  clipCount: number;
  /** Copies the clips into the playlist; true once they are in. */
  onAdd: (target: Playlist) => Promise<boolean>;
  /** Makes a playlist of that name with the clips; true once it exists. */
  onCreate: (name: string) => Promise<boolean>;
}

const ROW =
  "flex w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 disabled:opacity-50 disabled:active:scale-100 focus-visible:bg-fill-1 focus-visible:ring-2 focus-visible:ring-selection";

/**
 * Where the clips go: the user's other playlists, searchable by name and
 * folder, and the search doubling as the name of a new playlist (Return
 * creates it, in this playlist's folder). The row being added to spins until
 * the clips are in, so a second press can't add them twice. The desktop's
 * AddToPopover.
 */
function AddToBody({ candidates, clipCount, onAdd, onCreate, onDone, inputRef }: AddToProps & { onDone: () => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [search, setSearch] = React.useState("");
  const [addingId, setAddingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const busy = addingId !== null || creating;

  const trimmed = search.trim();
  const words = trimmed.toLocaleLowerCase("sv").split(/\s+/).filter(Boolean);
  const shown = (candidates ?? []).filter((c) => {
    if (words.length === 0) return true;
    const hay = `${c.playlist.name} ${c.path ?? ""}`.toLocaleLowerCase("sv");
    return words.every((w) => hay.includes(w));
  });
  const exact = (candidates ?? []).some((c) => c.playlist.name.toLocaleLowerCase("sv") === trimmed.toLocaleLowerCase("sv"));
  const canCreate = trimmed.length > 0 && !exact;

  async function add(target: Playlist) {
    if (busy) return;
    setAddingId(target.id);
    const ok = await onAdd(target);
    setAddingId(null);
    if (ok) onDone();
  }

  async function create() {
    if (!canCreate || busy) return;
    setCreating(true);
    const ok = await onCreate(trimmed);
    setCreating(false);
    if (ok) onDone();
  }

  return (
    <>
      <div className="px-3 pt-2.5 pb-1">
        <p className="text-subheadline font-semibold text-foreground">
          Add {clipCount} {clipCount === 1 ? "clip" : "clips"} to
        </p>
      </div>
      <div className="px-2 pt-1 pb-2">
        <SearchField
          ref={inputRef}
          value={search}
          placeholder="Search or create…"
          aria-label="Search playlists or name a new one"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) {
              e.preventDefault();
              void create();
            }
          }}
        />
      </div>

      {candidates === null ? (
        <p className="flex items-center gap-2 px-3 pb-3 text-callout text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading your playlists…
        </p>
      ) : shown.length > 0 ? (
        <div role="group" aria-label="Playlists" className="max-h-64 overflow-y-auto overscroll-contain px-1 pb-1">
          {shown.map((c) => (
            <button
              key={c.playlist.id}
              type="button"
              disabled={busy && addingId !== c.playlist.id}
              aria-busy={addingId === c.playlist.id}
              onClick={() => void add(c.playlist)}
              className={cn(ROW, "min-h-9 py-1 pointer-coarse:min-h-12")}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {addingId === c.playlist.id ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <ListVideo className="size-3.5" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{c.playlist.name}</span>
                {c.path && <span className="truncate text-caption text-muted-foreground">{c.path}</span>}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground nums">{c.clipCount}</span>
            </button>
          ))}
        </div>
      ) : (
        !canCreate && (
          <p className="px-3 pb-3 text-callout text-muted-foreground">
            {candidates.length === 0 ? "No other playlists yet. Type a name to create one." : "No playlist called that."}
          </p>
        )
      )}

      {canCreate && (
        <div className="border-t border-separator p-1">
          <button type="button" disabled={busy} onClick={() => void create()} className={cn(ROW, "min-h-9 pointer-coarse:min-h-12")}>
            <span className="flex size-4 shrink-0 items-center justify-center text-primary">
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1 truncate">
              Create &ldquo;<span className="font-medium">{trimmed}</span>&rdquo;
            </span>
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The popover's panel, for a Popover the caller holds: anchored to a row's ⋯
 * button when "Add to playlist…" is picked from its menu.
 */
export function AddToContent({
  onDone,
  align = "end",
  side = "bottom",
  onCloseAutoFocus,
  ...body
}: AddToProps & {
  onDone: () => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <PopoverContent
      align={align}
      side={side}
      collisionPadding={8}
      className="w-72 max-w-[calc(100vw-1rem)] p-0"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      onContextMenu={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <AddToBody {...body} onDone={onDone} inputRef={inputRef} />
    </PopoverContent>
  );
}

/** The popover on its own trigger: the selection bar's "Add to". `onOpenChange` lets the caller read the playlists as it opens. */
export function AddToPopover({
  trigger,
  onOpenChange,
  align = "center",
  side = "top",
  ...body
}: AddToProps & {
  trigger: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = React.useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <AddToContent align={align} side={side} {...body} onDone={() => change(false)} />
    </Popover>
  );
}
