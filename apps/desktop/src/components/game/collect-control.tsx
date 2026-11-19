import * as React from "react";
import { Check, ChevronDown, ChevronsUpDown, Clock, ListPlus, Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { playlistIsShared } from "@scoutable/shared/lib/playlist-sharing";
import { shipPhase, shipPill, type ShipPillPhase } from "@scoutable/shared/lib/ship-pill";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
 * "Search or create…" field doubles as the name of a new one, offered as
 * Create "name" once typed (the editor's "Add to another playlist"). Beside
 * it, "Open playlist" opens the target in the editor (with the way back here), and "Send n clips" cuts and
 * uploads, without leaving the game, the clips players don't have yet, while
 * any shared playlist holding this game's plays has such clips; with several
 * such playlists, that button opens a menu of them. While a send runs, the
 * button shows it and takes no second press.
 */
export function CollectControl({ collect, highlight }: { collect: Collect; highlight?: boolean }) {
  const { target, candidates, loading, pickerOpen, pickerAnchor, setPickerOpen, held, shipStatuses } = collect;
  // Asked for by a row's plus or the Now bar's Add, the picker grows from that control, not from here.
  const anchorRef = React.useMemo(() => ({ current: pickerAnchor }), [pickerAnchor]);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const trimmed = search.trim();
  const q = trimmed.toLowerCase();
  const options = candidates.filter((pl) => !q || pl.name.toLowerCase().includes(q));
  const exists = (name: string) => candidates.some((pl) => pl.name.toLowerCase() === name.toLowerCase());
  // Only a typed name makes a new playlist, as in the editor's "Search or create…": a row offering
  // a ready-made name read as the one way to create. (The play menu still offers one named after the game.)
  const createName = trimmed;
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
  const pill = shipPill(held, shipStatuses, target?.id ?? null);
  const unsentOf = (id: string) => held.find((h) => h.playlist.id === id);

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
              // A first visit's nudge is a tint: a ring here is how keyboard focus is drawn.
              highlight && !target && "bg-primary/10 text-primary ring-primary/40 hover:bg-primary/15 active:bg-primary/20 data-[state=open]:bg-primary/20",
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
              placeholder="Search or create…"
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
            !showCreateRow && <p className="px-3 pb-3 text-callout text-muted-foreground">Type a name to create a new playlist.</p>
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
                Create &ldquo;<span className="font-medium">{createName}</span>&rdquo;
              </span>
            </button>
          )}
        </PopoverContent>
      </Popover>
      {target && (
        <Button size="sm" variant="outline" onClick={collect.openTarget}>
          Open playlist
        </Button>
      )}
      {pill === null ? null : pill.kind === "several" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant={pill.worst === "unsent" ? "default" : "outline"}>
              <PhaseIcon phase={pill.worst} />
              {pill.label}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Not sent yet</DropdownMenuLabel>
            {held.map(({ playlist, count }) => {
              const phase = shipPhase(shipStatuses.get(playlist.id));
              return (
                <DropdownMenuItem key={playlist.id} disabled={phase === "sending"} onSelect={() => void collect.send(playlist.id)}>
                  <PhaseIcon phase={phase} />
                  <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                  <span className="shrink-0 text-xs nums text-muted-foreground">
                    {phase === "sending" ? "Sending…" : phase === "waiting" ? `${count} waiting` : count}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : pill.kind === "sending" ? (
        <Button size="sm" variant="outline" disabled>
          <Loader2 className="animate-spin" />
          <span className="max-w-56 truncate">{pill.label}</span>
        </Button>
      ) : pill.kind === "waiting" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" onClick={() => void collect.send(pill.playlistId)}>
              <Clock />
              <span className="max-w-56 truncate">{pill.label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Players get these once you pause adding, switch playlist or leave the game. Click to send now.</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={() => void collect.send(pill.playlistId)}>
              <Send />
              <span className="max-w-56 truncate">{pill.label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{heldTooltip(unsentOf(pill.playlistId)?.playlist.name ?? "", unsentOf(pill.playlistId)?.count ?? 0)}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

/** Waiting: a clock. Sending: a spinner. Not sent: the send arrow. */
function PhaseIcon({ phase }: { phase: ShipPillPhase }) {
  if (phase === "sending") return <Loader2 className="animate-spin" />;
  if (phase === "waiting") return <Clock />;
  return <Send />;
}

function heldTooltip(name: string, n: number): string {
  return `Players have ${name}. ${n === 1 ? "1 clip isn't" : `${n} clips aren't`} sent yet: this cuts and uploads ${n === 1 ? "it" : "them"} from here.`;
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
