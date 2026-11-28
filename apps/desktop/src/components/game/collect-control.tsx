import * as React from "react";
import { AlertTriangle, Check, ChevronsUpDown, ListPlus, Loader2, Plus, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";
import { playlistIsShared } from "@scoutable/shared/lib/playlist-sharing";
import { shipIndicator } from "@scoutable/shared/lib/ship-pill";
import { Button } from "@/components/ui/button";
import { ToolbarAction, useToolbarTight } from "@/components/shell/toolbar";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sentry } from "@/lib/sentry";
import { cn } from "@/lib/utils";
import { isReportClips, type Playlist } from "@/types/match";
import type { Collect } from "./use-collect";

/**
 * The playlist the game's plays are collected into, chosen once: "Choose
 * playlist…" until it is, then "Adding to" with its name and its count. The
 * list puts the playlists that already hold this game's clips first, and its
 * "Search or create…" field doubles as the name of a new one, offered as
 * Create "name" once typed (the editor's "Add to another playlist"). Beside
 * it, "Open playlist" opens the target in the editor (with the way back
 * here). Clips for players go out by themselves, so their state stays quiet
 * (`shipIndicator`): nothing while they wait, a small ring on the count while
 * the target's are sent (beside the control for another playlist), and only
 * clips that didn't go ask for the coach: "n not sent", whose popover sends
 * them again. In a compact toolbar "Open playlist" is its icon; in a tight one "Adding to" goes, and the
 * playlist's name and count stay (the control's name still says it).
 */
export function CollectControl({ collect, highlight }: { collect: Collect; highlight?: boolean }) {
  const { target, candidates, loading, pickerOpen, pickerAnchor, setPickerOpen, held, shipStatuses } = collect;
  const tight = useToolbarTight();
  // Asked for by a row's plus or the Now bar's Add, the picker grows from that control, not from here.
  const anchorRef = React.useMemo(() => ({ current: pickerAnchor }), [pickerAnchor]);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const trimmed = search.trim();
  const q = trimmed.toLowerCase();
  const options = candidates.filter((pl) => !q || pl.name.toLowerCase().includes(q));
  // A report's own clips are a group of their own, after the playlists (docs/game-view.md, "Collecting into a report").
  const playlistOptions = options.filter((pl) => !isReportClips(pl));
  const reportOptions = options.filter(isReportClips);
  const targetIsReport = !!target && isReportClips(target);
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
  const { sending, unsent } = shipIndicator(held, shipStatuses, target?.id ?? null);
  const sendingHere = sending?.onTarget ? sending : null;
  const sendingElsewhere = sending && !sending.onTarget ? sending : null;

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
            aria-label={
              target
                ? `Adding to ${target.name}.${sendingHere ? ` ${sendingHere.label}.` : ""} Change playlist`
                : "Choose the playlist to add plays to"
            }
            className={cn(
              "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md bg-fill-1 pr-1.5 pl-2.5 text-sm outline-none",
              tight ? "max-w-44" : "max-w-64",
              "transition-[background-color,transform,box-shadow] duration-100 hover:bg-fill-2 active:scale-[0.98] active:bg-fill-3 data-[state=open]:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection",
              // A first visit's nudge is a tint: a ring here is how keyboard focus is drawn.
              highlight && !target && "bg-primary/10 text-primary hover:bg-primary/15 active:bg-primary/20 data-[state=open]:bg-primary/20",
            )}
          >
            {target ? (
              <>
                {!tight && <span className="shrink-0 text-muted-foreground">Adding to</span>}
                <span className="min-w-0 truncate font-medium">{target.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fill-2 px-1.5 text-xs nums text-muted-foreground">
                  {sendingHere && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <SendRing done={sendingHere.done} total={sendingHere.total} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{sendingHere.label}</TooltipContent>
                    </Tooltip>
                  )}
                  {clipCount}
                </span>
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
            <p className="text-subheadline text-muted-foreground">Every play you add goes into this playlist or report.</p>
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
              {reportOptions.length > 0 && playlistOptions.length > 0 && <GroupLabel>Playlists</GroupLabel>}
              {playlistOptions.map((pl) => (
                <PlaylistOption key={pl.id} playlist={pl} selected={pl.id === target?.id} onChoose={() => collect.chooseTarget(pl, "existing")} />
              ))}
              {reportOptions.length > 0 && <GroupLabel>Reports</GroupLabel>}
              {reportOptions.map((pl) => (
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
        <ToolbarAction label={targetIsReport ? "Open report" : "Open playlist"}>
          {(compact) => (
            <Button size={compact ? "icon-sm" : "sm"} variant="outline" onClick={collect.openTarget} aria-label={compact ? (targetIsReport ? "Open report" : "Open playlist") : undefined}>
              {compact ? <SquareArrowOutUpRight /> : targetIsReport ? "Open report" : "Open playlist"}
            </Button>
          )}
        </ToolbarAction>
      )}
      {sendingElsewhere && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span role="status" aria-label={sendingElsewhere.label} data-toolbar-transient className="inline-flex size-8 items-center justify-center text-muted-foreground">
              <SendRing done={sendingElsewhere.done} total={sendingElsewhere.total} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{sendingElsewhere.label}</TooltipContent>
        </Tooltip>
      )}
      {unsent && (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="text-warning">
              <AlertTriangle />
              {unsent.label}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <div className="px-3 pt-3 pb-2">
              <p className="text-headline">Not sent to players</p>
              <p className="text-subheadline text-muted-foreground">
                Players don't have these clips yet. If sending fails again, check the game's sync and its video file.
              </p>
            </div>
            <div className="px-1 pb-1">
              {unsent.playlists.map((pl) => (
                <div key={pl.id} className="flex h-9 items-center gap-2 rounded-md px-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{pl.name}</span>
                  <span className="shrink-0 text-xs nums text-muted-foreground">{pl.count}</span>
                  <Button size="xs" variant="outline" onClick={() => void collect.send(pl.id)}>
                    Send again
                  </Button>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

/**
 * A send in progress, as quiet as a progress glyph gets: a 12 px ring that
 * fills as clips go up, spinning (when motion is allowed) until the first
 * one has.
 */
function SendRing({ done, total }: { done: number; total: number }) {
  const r = 4.5;
  const length = 2 * Math.PI * r;
  const share = total > 0 ? done / total : 0;
  const arc = share > 0 ? Math.max(0.08, share) * length : 0.25 * length;
  return (
    <svg viewBox="0 0 12 12" className={cn("size-3 shrink-0", share === 0 && "motion-safe:animate-spin")} aria-hidden="true">
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.6} />
      <circle
        cx="6"
        cy="6"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeDasharray={`${arc} ${length}`}
        transform="rotate(-90 6 6)"
        className="transition-[stroke-dasharray] duration-300 ease-out"
      />
    </svg>
  );
}

/** A group's name in the list ("Playlists", "Reports"), shown only when both are there. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pt-2 pb-1 text-caption font-medium text-muted-foreground">{children}</p>;
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
