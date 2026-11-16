/**
 * The search panel (⌘K, Ctrl+K, the sidebar's Search; docs/search.md): a
 * field in the upper part of the window with what it finds under it. Before a
 * query it offers what was opened last on this computer; a query lists
 * playlists, reports and games by name, grouped in the sidebar's order.
 *
 * Built on the app's own dialog parts, with the keys and roles of the Add
 * clips game picker (components/editor/game-picker.tsx): the field keeps the
 * focus and the list is moved through with aria-activedescendant. The list is
 * never animated and the highlight moves at once. The scrim only dims: no
 * blur is drawn over a video that keeps playing behind it.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Film, ListVideo, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  isSearchQuery,
  newestItems,
  recentItems,
  searchIndex,
  type SearchItem,
  type SearchKind,
} from "@scoutable/shared/lib/quick-search";
import { reportStatusLabel } from "@scoutable/shared/lib/scouting-report-list";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { trackEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/format-date";
import { gameTabsScope, useGameTabs } from "@/lib/game-tabs";
import { scrimVariants, searchVariants } from "@/lib/motion";
import {
  closeQuickSearch,
  refreshSearchIndex,
  useQuickSearchOpen,
  useSearchIndex,
  type SearchScope,
} from "@/lib/quick-search-store";
import { readRecentOpens, recentOpensScope } from "@/lib/recent-opens";
import { cn } from "@/lib/utils";

const ICON: Record<SearchKind, React.ComponentType<{ className?: string }>> = { playlist: ListVideo, report: FileText, game: Film };
const KIND: Record<SearchKind, string> = { playlist: "Playlist", report: "Report", game: "Game" };
const KINDS: Record<SearchKind, string> = { playlist: "Playlists", report: "Reports", game: "Games" };

interface Section {
  label: string;
  items: SearchItem[];
  /** How many there are when not all are shown. */
  total: number;
  /** Kinds side by side (Recent): each row says what it is. */
  mixed: boolean;
}

/** What stands to the right of a row's name: where a playlist is, how a report stands, when a game was played. */
function detailOf(item: SearchItem): string {
  if (item.kind === "playlist") return item.folder.join(" › ");
  if (item.kind === "report") {
    const status = reportStatusLabel(item.report);
    return item.report.playlistName !== item.title ? `${item.report.playlistName} · ${status}` : status;
  }
  const date = item.date ? formatDate(item.date) : "";
  if (!item.archived) return date;
  return date ? `Archived · ${date}` : "Archived";
}

export default function QuickSearch({ scope }: { scope: SearchScope }) {
  const open = useQuickSearchOpen();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && closeQuickSearch()}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount key="quick-search">
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div variants={scrimVariants} initial="hidden" animate="visible" exit="exit" className="fixed inset-0 z-50 bg-black/35" />
            </DialogPrimitive.Overlay>
            {/* The window stays movable by its title strip, as under a sheet (components/ui/sheet.tsx). Unlike a
                sheet the panel closes on that press, as on any press outside it: the drag swallows the click
                Radix would have closed on (components/ui/popover.tsx). */}
            <div
              data-tauri-drag-region
              aria-hidden
              onPointerDown={(e) => e.button === 0 && closeQuickSearch()}
              className="pointer-events-auto fixed inset-x-0 top-0 z-50 h-[var(--titlebar-inset)]"
            />
            <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-4 pt-[max(16vh,calc(var(--titlebar-inset)+0.75rem))] pb-4">
              <SearchBody scope={scope} />
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/** Mounted with each open: the field starts empty, and what was opened last is read once. */
function SearchBody({ scope }: { scope: SearchScope }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const state = useSearchIndex(scope);
  const tabs = useGameTabs(gameTabsScope(scope.userId, scope.orgId));
  const [recents] = useState(() => readRecentOpens(recentOpensScope(scope.userId, scope.orgId)));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Where the keys were when the panel opened. They go back there the moment it is dismissed, not when
  // its motion ends (a modal Radix dialog would hand them to a trigger this panel doesn't have). After a
  // choice they are left to the page that opens: the sidebar's Search must not take the next Space.
  const open = useQuickSearchOpen();
  const cameFrom = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const chose = useRef(false);
  useEffect(() => {
    if (open) return;
    const back = chose.current ? null : cameFrom.current;
    if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    else inputRef.current?.blur();
  }, [open]);
  const optionId = (i: number) => `${listId}-${i}`;

  // What is held shows at once; it is read again behind it (lib/quick-search-store.ts).
  useEffect(() => {
    refreshSearchIndex(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.userId, scope.orgId, scope.personal]);

  // A first read usually lands before anyone could read "Loading…": say it only when it doesn't.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 300);
    return () => window.clearTimeout(timer);
  }, []);

  const index = state.index;
  const searching = isSearchQuery(query);
  const { sections, from } = useMemo((): { sections: Section[]; from: "results" | "recent" | "newest" } => {
    if (!index) return { sections: [], from: "results" };
    if (searching) {
      const groups = searchIndex(index, query, recents);
      return { sections: groups.map((g) => ({ label: KINDS[g.kind], items: g.items, total: g.total, mixed: false })), from: "results" };
    }
    const recent = recentItems(index, recents);
    if (recent.length > 0) return { sections: [{ label: "Recent", items: recent, total: recent.length, mixed: true }], from: "recent" };
    return { sections: newestItems(index).map((g) => ({ label: KINDS[g.kind], items: g.items, total: g.items.length, mixed: false })), from: "newest" };
  }, [index, searching, query, recents]);
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  // The list can shrink under the highlight when the index is read again.
  const at = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    document.getElementById(optionId(at))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, flat]);

  function choose(item: SearchItem, position: number) {
    trackEvent("search_result_opened", { kind: item.kind, from, position, query_length: query.trim().length });
    chose.current = true;
    closeQuickSearch();
    if (item.kind === "game") {
      if (pathname === `/matches/${item.id}`) return;
      // On the game page the switch replaces the entry, as its tabs do: Back leaves the games.
      const onGame = /^\/matches\/[^/]+$/.test(pathname);
      const hasTab = tabs.tabs.some((t) => t.id === item.id);
      navigate(`/matches/${item.id}`, { replace: onGame, state: { via: hasTab ? "search_tab" : "search" } });
      return;
    }
    navigate("/playlists", { state: { restore: { playlistId: item.id }, view: item.kind === "report" ? "report" : "clips" } });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(Math.max(0, Math.min(flat.length - 1, at + step)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[at];
      if (item) choose(item, at);
    }
  }

  let row = 0;
  return (
    <DialogPrimitive.Content
      forceMount
      asChild
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
      }}
      // The keys were already given back when the panel was dismissed (above).
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <motion.div
        data-quick-search=""
        variants={searchVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="pointer-events-auto flex max-h-[min(60vh,34rem)] w-full max-w-[640px] origin-top flex-col overflow-hidden rounded-window bg-material-sheet text-foreground shadow-dialog outline-none"
      >
        <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-separator px-3.5">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search playlists, reports and games"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            role="combobox"
            aria-label="Search playlists, reports and games"
            aria-autocomplete="list"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={flat[at] ? optionId(at) : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-title-3 font-normal text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {sections.map((section) => (
            <div key={section.label} role="group" aria-label={section.label}>
              <div role="presentation" className="flex items-baseline gap-1.5 px-3.5 pt-1.5 pb-1 text-subheadline font-medium text-muted-foreground">
                {section.label}
                {section.total > section.items.length && (
                  <span className="nums font-normal">
                    {section.items.length} of {section.total}
                  </span>
                )}
              </div>
              {section.items.map((item) => {
                const i = row++;
                const Icon = ICON[item.kind];
                const on = i === at;
                const detail = detailOf(item);
                const aside = section.mixed ? [detail, KIND[item.kind]].filter(Boolean).join(" · ") : detail;
                return (
                  <div
                    key={`${item.kind}:${item.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={on}
                    // Only a pointer that moves takes the highlight: a list that changes under a resting one doesn't.
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(item, i)}
                    // The highlight is where the keys or the pointer are, not a choice made: the app's neutral
                    // fill, as under a hovered row and in the tab bar's game picker. The accent is kept for
                    // what is selected (the open playlist, the play that is on).
                    className={cn("mx-1.5 flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm text-foreground active:bg-fill-3", on && "bg-fill-2")}
                  >
                    <Icon className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {aside && <span className="max-w-[50%] shrink-0 truncate text-callout nums text-muted-foreground">{aside}</span>}
                  </div>
                );
              })}
            </div>
          ))}

          {state.status === "ready" && flat.length === 0 && searching && (
            <div className="px-3.5 py-8 text-center">
              <p className="text-sm text-foreground">No results for “{query.trim()}”</p>
              <p className="mt-1 text-callout text-muted-foreground">Search finds playlists, reports and games by name.</p>
            </div>
          )}
          {state.status === "ready" && state.index.entries.length === 0 && !searching && (
            <div className="flex flex-col items-center gap-3 px-3.5 py-8 text-center">
              <p className="text-sm text-muted-foreground">Nothing to search yet. Import a game to get started.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  chose.current = true;
                  closeQuickSearch();
                  navigate("/upload");
                }}
              >
                Import game
              </Button>
            </div>
          )}
          {state.status === "loading" && slow && <p className="px-3.5 py-8 text-center text-callout text-muted-foreground">Loading…</p>}
          {state.status === "error" && (
            <div className="flex flex-col items-center gap-3 px-3.5 py-8 text-center">
              <p className="text-sm text-muted-foreground">Couldn’t load your playlists, reports and games.</p>
              <Button size="sm" variant="outline" onClick={() => refreshSearchIndex(scope)}>
                Try again
              </Button>
            </div>
          )}
        </div>

        <p aria-live="polite" className="sr-only">
          {state.status === "ready" && searching ? `${flat.length} ${flat.length === 1 ? "result" : "results"}` : ""}
        </p>
        <div aria-hidden className="flex shrink-0 items-center gap-4 border-t border-separator px-3.5 py-1.5 text-subheadline text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            Move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↩</Kbd>
            Open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            Close
          </span>
        </div>
      </motion.div>
    </DialogPrimitive.Content>
  );
}
