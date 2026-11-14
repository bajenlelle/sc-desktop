import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { pickableGames, type PickableGame } from "@scoutable/shared/lib/game-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format-date";
import { listMatchesLight } from "@/lib/matches-db";
import { cn } from "@/lib/utils";
import type { StoredMatch } from "@/types/match";

/**
 * The "+" after the last tab: a picker of the Library's games, so another
 * game opens in a tab without leaving the one on screen. It lists what the
 * Library lists (archived games left out), searched the way the Library is;
 * a game that already has a tab says so, and choosing it goes to that tab.
 * Return opens the first game listed.
 */
export function GameTabPicker({
  orgId,
  openIds,
  onPick,
}: {
  orgId: string | null;
  /** The games that have a tab. */
  openIds: ReadonlySet<string>;
  onPick: (game: PickableGame) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // null while the Library is being read.
  const [games, setGames] = useState<StoredMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Read when the picker opens: a game imported a minute ago is there.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(false);
    listMatchesLight(orgId ?? undefined, { ownOnly: true })
      .then((list) => {
        if (!cancelled) setGames(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  const rows = useMemo(() => (games ? pickableGames(games, search, openIds) : []), [games, search, openIds]);
  const choose = (game: PickableGame) => {
    setOpen(false);
    onPick(game);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Open another game"
              className="mb-0.5 ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-95 active:bg-fill-3 data-[state=open]:bg-fill-2 data-[state=open]:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
            >
              <Plus className="size-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Open another game</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="p-2">
          <SearchField
            ref={inputRef}
            placeholder="Search games"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rows.length > 0) {
                e.preventDefault();
                choose(rows[0]);
              }
            }}
          />
        </div>
        {failed ? (
          <p className="px-3 pb-3 text-callout text-muted-foreground">Couldn’t load your games. Close this and try again.</p>
        ) : games === null ? (
          <p className="flex items-center gap-2 px-3 pb-3 text-callout text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading games…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 pb-3 text-callout text-muted-foreground">{search.trim() ? "No game of that name." : "No games in the Library yet."}</p>
        ) : (
          <div className="max-h-72 overflow-y-auto px-1 pb-1">
            {rows.map((game, i) => (
              <button
                key={game.id}
                type="button"
                onClick={() => choose(game)}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:bg-fill-1",
                  // While something is typed, the first game is the one Return opens.
                  i === 0 && search.trim() && "bg-fill-1",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{game.title}</span>
                {game.open && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-caption text-primary">Open</span>}
                {game.date && <span className="shrink-0 text-xs nums text-muted-foreground">{formatDate(game.date, "short")}</span>}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
