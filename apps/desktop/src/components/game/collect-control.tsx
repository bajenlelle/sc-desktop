import * as React from "react";
import { Check, ChevronsUpDown, ListPlus, Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { playlistIsShared } from "@scoutable/shared/lib/playlist-sharing";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sentry } from "@/lib/sentry";
import { cn } from "@/lib/utils";
import type { Playlist } from "@/types/match";
import type { Collect } from "./use-collect";

/**
 * The playlist the game's plays are collected into, chosen once: "Choose
 * playlist…" until it is, then "Adding to" with its name and its count. The
 * list puts the playlists that already hold this game's clips first, and its
 * search field doubles as the name of a new one (the mechanics of the
 * editor's "Add to another playlist"). Beside it, the way to the playlist:
 * "Open playlist", or "Send n clips…" while players are waiting for some.
 */
export function CollectControl({ collect, highlight }: { collect: Collect; highlight?: boolean }) {
  const { target, candidates, loading, pickerOpen, pickerAnchor, setPickerOpen, unsent } = collect;
  // Asked for by a row's plus or the Now bar's Add, the picker grows from that control, not from here.
  const anchorRef = React.useMemo(() => ({ current: pickerAnchor }), [pickerAnchor]);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const trimmed = search.trim();
  const q = trimmed.toLowerCase();
  const options = candidates.filter((pl) => !q || pl.name.toLowerCase().includes(q));
  const exists = (name: string) => candidates.some((pl) => pl.name.toLowerCase() === name.toLowerCase());
  // Typed: a playlist of that name. Not typed: one named after the game, the usual case.
  const createName = trimmed || collect.suggestedName;
  const showCreateRow = createName.length > 0 && !exists(createName);

  async function create() {
    if (!showCreateRow || creating) return;
    setCreating(true);
    try {
      await collect.createTarget(createName);
    } catch (e) {
      Sentry.captureException(e);
      toast.error("Couldn't create the playlist", { description: "Check the connection and try again." });
    } finally {
      setCreating(false);
    }
  }

  const clipCount = target ? target.items.filter((i) => i.type === "clip").length : 0;

  return (
    <>
      <Popover
        open={pickerOpen}
        onOpenChange={(next) => {
          setPickerOpen(next);
          if (next) setSearch("");
        }}
      >
        {pickerAnchor && <PopoverAnchor virtualRef={anchorRef} />}
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={target ? `Adding to ${target.name}. Change playlist` : "Choose the playlist to add plays to"}
            className={cn(
              "inline-flex h-8 max-w-64 min-w-0 items-center gap-1.5 rounded-md bg-card pr-1.5 pl-2.5 text-sm shadow-xs ring-1 ring-separator outline-none",
              "transition-[background-color,transform,box-shadow] duration-100 hover:bg-fill-1 active:scale-[0.98] active:bg-fill-2 data-[state=open]:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection",
              highlight && !target && "ring-2 ring-primary",
            )}
          >
            {target ? (
              <>
                <span className="shrink-0 text-muted-foreground">Adding to</span>
                <span className="min-w-0 truncate font-medium">{target.name}</span>
                <span className="shrink-0 rounded-full bg-fill-2 px-1.5 text-xs nums text-muted-foreground">{clipCount}</span>
              </>
            ) : (
              <>
                <ListPlus className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Choose playlist…</span>
              </>
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="w-80 p-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="px-3 pt-3 pb-1">
            <p className="text-headline">Add plays to</p>
            <p className="text-subheadline text-muted-foreground">Every play you add goes into this playlist.</p>
          </div>
          <div className="p-2">
            <SearchField
              ref={inputRef}
              placeholder="Search or name a new playlist"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmed && showCreateRow) {
                  e.preventDefault();
                  void create();
                }
              }}
            />
          </div>
          {loading ? (
            <p className="flex items-center gap-2 px-3 pb-3 text-callout text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading playlists…
            </p>
          ) : options.length > 0 ? (
            <div className="max-h-64 overflow-y-auto px-1 pb-1">
              {options.map((pl) => (
                <PlaylistOption key={pl.id} playlist={pl} selected={pl.id === target?.id} onChoose={() => collect.chooseTarget(pl, "existing")} />
              ))}
            </div>
          ) : (
            !showCreateRow && <p className="px-3 pb-3 text-callout text-muted-foreground">No playlist of that name.</p>
          )}
          {!loading && showCreateRow && (
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 border-t border-separator px-3 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:bg-fill-1 disabled:opacity-50"
              onClick={() => void create()}
              disabled={creating}
            >
              {creating ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : <Plus className="size-3.5 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1 truncate">
                New playlist &ldquo;<span className="font-medium">{createName}</span>&rdquo;
              </span>
            </button>
          )}
        </PopoverContent>
      </Popover>
      {target &&
        (unsent > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onClick={collect.openTarget}>
                <Send />
                Send {unsent} {unsent === 1 ? "clip" : "clips"}…
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Players have this playlist. {unsent === 1 ? "1 clip isn't" : `${unsent} clips aren't`} uploaded yet: open it to send {unsent === 1 ? "it" : "them"}.
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button size="sm" variant="outline" onClick={collect.openTarget}>
            Open playlist
          </Button>
        ))}
    </>
  );
}

function PlaylistOption({ playlist, selected, onChoose }: { playlist: Playlist; selected: boolean; onChoose: () => void }) {
  const clips = playlist.items.filter((i) => i.type === "clip").length;
  return (
    <button
      type="button"
      aria-pressed={selected}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:bg-fill-1"
      onClick={onChoose}
    >
      <Check className={cn("size-3.5 shrink-0 text-primary", !selected && "invisible")} />
      <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
      {playlistIsShared(playlist) && <span className="shrink-0 text-xs text-muted-foreground">Shared</span>}
      <span className="shrink-0 text-xs nums text-muted-foreground">{clips}</span>
    </button>
  );
}
