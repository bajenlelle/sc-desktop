import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { TriggerButton } from "@/components/ui/multi-select-dropdown";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  MAX_BROWSER_GAMES,
  gameGroups,
  latestGames,
  teamGames,
  toggleGame,
  type BrowserGame,
} from "@scoutable/shared/lib/add-clips-games";
import type { PlaylistItem } from "@/types/match";

interface Option {
  /** Unique across both groups: a game in the top group is also in the full list. */
  key: string;
  game: BrowserGame;
  clips: number | null;
}

/** How the games were chosen, for analytics: a row, a checkbox (or ⌘Return), or a footer button. */
export type GamePickVia = "pick" | "toggle" | "latest" | "team";

/**
 * The Add clips sheet's Game filter: the playlist's own games on top with
 * their clip counts, then every game by date, latest first, and a search
 * over titles and team names (lib/add-clips-games.ts). A row picks that game
 * alone; its checkbox adds it to the others (up to MAX_BROWSER_GAMES), and
 * the footer picks the latest games, or a team's. Typing, ↑/↓ and Return
 * pick a game without leaving the keyboard; ⌘Return ticks it.
 */
export function GamePicker({
  matches,
  items,
  value,
  onChange,
  quickTeam,
}: {
  matches: readonly BrowserGame[];
  /** The playlist's items, for its games and their clip counts. */
  items: readonly PlaylistItem[];
  /** The chosen games, never empty while there are games. */
  value: readonly string[];
  onChange: (ids: string[], via: GamePickVia) => void;
  /** The team "Last 5 games of …" offers (the chosen player's or team's); null for none. */
  quickTeam: string | null;
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
  // The first chosen game is where the keys start; a new search starts at the top.
  useEffect(() => {
    if (!open) return;
    const at = query ? 0 : options.findIndex((o) => o.game.id === value[0]);
    setActive(Math.max(0, at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);
  const optionId = (i: number) => `${listId}-${i}`;
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const chosen = new Set(value);
  const full = value.length >= MAX_BROWSER_GAMES;
  const teamIds = useMemo(() => (quickTeam ? teamGames(matches, quickTeam) : []), [matches, quickTeam]);

  // However the list closes (a row, a footer button, Escape, a click outside), it reopens on every game.
  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(id: string) {
    onChange([id], "pick");
    close();
  }

  function toggle(id: string) {
    const next = toggleGame(value, id);
    // Unticking the only game or ticking one past the cap changes nothing: no event, no scope rewrite.
    if (next.length === value.length) return;
    onChange(next, "toggle");
  }

  function choose(ids: string[], via: GamePickVia) {
    if (ids.length === 0) return;
    onChange(ids, via);
    close();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(options.length - 1, i + step)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[active];
      if (!option) return;
      if (e.metaKey || e.ctrlKey) toggle(option.game.id);
      else pick(option.game.id);
    }
  }

  const current = value.length === 1 ? matches.find((m) => m.id === value[0]) : undefined;
  const label = value.length > 1 ? `${value.length} games` : (current?.title ?? "Game");
  const row = (option: Option, i: number) => {
    const selected = chosen.has(option.game.id);
    const capped = full && !selected;
    return (
      <div
        key={option.key}
        id={optionId(i)}
        role="option"
        aria-selected={selected}
        onPointerMove={() => setActive(i)}
        onClick={() => pick(option.game.id)}
        // Where the keys or the pointer are takes the neutral fill; the tick says what is chosen.
        className={cn("flex cursor-default items-center gap-2 px-3 py-1.5 text-sm text-foreground active:bg-fill-3", i === active && "bg-fill-2")}
      >
        {/* The wrapper holds the title and the click, so a disabled box neither hides why nor picks its row. */}
        <span className="flex shrink-0 items-center" title={capped ? "Up to 10 games at a time" : undefined} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            disabled={capped}
            title={capped ? "Up to 10 games at a time" : undefined}
            onChange={() => {}}
            // No focus on press: the search field keeps the keys.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              toggle(option.game.id);
            }}
            aria-label={`Include ${option.game.title}`}
            className="size-3.5 rounded accent-primary"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{option.game.title}</span>
          <span className="block truncate text-caption nums text-muted-foreground">
            {option.clips !== null ? `${option.clips} ${option.clips === 1 ? "clip" : "clips"} · ` : ""}
            {formatDate(option.game.date)}
          </span>
        </span>
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
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <TriggerButton label={label} active={value.length > 0} className="max-w-[280px]" aria-label="Game" />
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
        <div id={listId} role="listbox" aria-multiselectable="true" aria-label="Games" className="max-h-80 overflow-y-auto rounded-md">
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
        <div className="flex flex-wrap items-center gap-1 border-t border-separator pt-2">
          <Button variant="ghost" size="xs" onClick={() => choose(latestGames(matches), "latest")} disabled={matches.length === 0}>
            Last 5 games
          </Button>
          {quickTeam && teamIds.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => choose(teamIds, "team")} className="min-w-0">
              <span className="truncate">Last 5 games of {quickTeam}</span>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
