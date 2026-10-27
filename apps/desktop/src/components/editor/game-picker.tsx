import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { TriggerButton } from "@/components/ui/multi-select-dropdown";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { gameGroups, type BrowserGame } from "@scoutable/shared/lib/add-clips-games";
import type { PlaylistItem } from "@/types/match";

interface Option {
  /** Unique across both groups: a game in the top group is also in the full list. */
  key: string;
  game: BrowserGame;
  clips: number | null;
}

/**
 * The Add clips sheet's Game filter: the playlist's own games on top with
 * their clip counts, then every game by date, latest first, and a search
 * over titles and team names (lib/add-clips-games.ts). Typing, ↑/↓ and
 * Return pick a game without leaving the keyboard.
 */
export function GamePicker({
  matches,
  items,
  value,
  onChange,
}: {
  matches: readonly BrowserGame[];
  /** The playlist's items, for its games and their clip counts. */
  items: readonly PlaylistItem[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const { inPlaylist, all } = useMemo(() => gameGroups(matches, items, query), [matches, items, query]);
  const options = useMemo<Option[]>(
    () => [
      ...inPlaylist.map((g) => ({ key: `playlist:${g.match.id}`, game: g.match, clips: g.clips })),
      ...all.map((game) => ({ key: `all:${game.id}`, game, clips: null })),
    ],
    [inPlaylist, all],
  );
  const [active, setActive] = useState(0);
  // The current game is where the keys start; a new search starts at the top.
  useEffect(() => {
    if (!open) return;
    const at = query ? 0 : options.findIndex((o) => o.game.id === value);
    setActive(Math.max(0, at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);
  const optionId = (i: number) => `${listId}-${i}`;
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(options.length - 1, i + step)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[active];
      if (option) pick(option.game.id);
    }
  }

  const current = matches.find((m) => m.id === value);
  const row = (option: Option, i: number) => {
    const selected = option.game.id === value;
    return (
      <div
        key={option.key}
        id={optionId(i)}
        role="option"
        aria-selected={selected}
        onPointerMove={() => setActive(i)}
        onClick={() => pick(option.game.id)}
        className={cn(
          "flex cursor-default items-center gap-2 px-3 py-1.5 text-sm",
          i === active ? "bg-selection text-selection-foreground" : "text-foreground",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{option.game.title}</span>
          <span className={cn("block truncate text-caption nums", i === active ? "text-selection-foreground/80" : "text-muted-foreground")}>
            {option.clips !== null ? `${option.clips} ${option.clips === 1 ? "clip" : "clips"} · ` : ""}
            {formatDate(option.game.date)}
          </span>
        </span>
        <Check aria-hidden className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      </div>
    );
  };
  const header = (label: string) => (
    <div role="presentation" className="sticky top-0 z-10 border-b border-separator bg-material-toolbar px-3 py-1 text-subheadline font-medium text-muted-foreground backdrop-blur-xl">
      {label}
    </div>
  );

  return (
    // Modal, so its list scrolls inside the Add clips sheet (see components/ui/popover.tsx).
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <TriggerButton label={current?.title ?? "Game"} active={!!current} className="max-w-[280px]" aria-label="Game" />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[380px] flex-col gap-2 p-2">
        <SearchField
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search games or teams"
          spellCheck={false}
          autoCorrect="off"
          autoComplete="off"
          role="combobox"
          aria-label="Search games or teams"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={options[active] ? optionId(active) : undefined}
        />
        <div id={listId} role="listbox" aria-label="Games" className="max-h-80 overflow-y-auto rounded-md">
          {options.length === 0 && <p className="px-3 py-6 text-center text-callout text-muted-foreground">No games match “{query.trim()}”.</p>}
          {inPlaylist.length > 0 && (
            <div role="group" aria-label="In this playlist">
              {header("In this playlist")}
              {options.slice(0, inPlaylist.length).map((o, i) => row(o, i))}
            </div>
          )}
          {all.length > 0 && (
            <div role="group" aria-label="All games">
              {header("All games")}
              {options.slice(inPlaylist.length).map((o, i) => row(o, i + inPlaylist.length))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
