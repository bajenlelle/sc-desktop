import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { pickableGames, type PickableGame } from "@scoutable/shared/lib/game-picker";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { formatDate } from "@/lib/format-date";
import { listMatchesLight } from "@/lib/matches-db";
import { cn } from "@/lib/utils";
import type { StoredMatch } from "@/types/match";

/**
 * A picker of the Library's games, so another game opens without leaving the
 * one on screen: from the + after the sidebar's "Open games", from New Tab
 * (⌘T), and, with the sidebar hidden, from the game title's menu. It lists
 * what the Library lists (archived games left out), searched the way the
 * Library is; a game that is already open says so, and choosing it goes to it.
 * Return opens the first game listed.
 */
export function GameTabPicker({
  open,
  onOpenChange,
  orgId,
  openIds,
  onPick,
  children,
  anchor = false,
  side = "bottom",
  align = "start",
}: {
  /** Open or not is the caller's to say: New Tab (⌘T) opens it as the + does. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  /** The games that are open. */
  openIds: ReadonlySet<string>;
  onPick: (game: PickableGame) => void;
  /** The element it opens from: its trigger, or with `anchor` only where it is placed (another control opens it). */
  children: ReactNode;
  anchor?: boolean;
  side?: "bottom" | "right";
  align?: "start" | "center";
}) {
  const [search, setSearch] = useState("");
  // null while the Library is being read.
  const [games, setGames] = useState<StoredMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Another space has other games: its list starts empty, not as the last space's.
  useEffect(() => setGames(null), [orgId]);

  // Read when the picker opens: a game imported a minute ago is there. It opens on an empty search.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearch("");
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
    onOpenChange(false);
    onPick(game);
  };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
    >
      {anchor ? <PopoverAnchor asChild>{children}</PopoverAnchor> : <PopoverTrigger asChild>{children}</PopoverTrigger>}
      <PopoverContent
        align={align}
        side={side}
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
          <p className="px-3 pb-3 text-callout text-muted-foreground">{search.trim() ? "No game of that name." : "No games yet."}</p>
        ) : (
          <div className="max-h-72 overflow-y-auto px-1 pb-1">
            {rows.map((game, i) => (
              <button
                key={game.id}
                type="button"
                onClick={() => choose(game)}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:bg-fill-1",
                  // The first game is the one Return opens.
                  i === 0 && "bg-fill-1",
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
