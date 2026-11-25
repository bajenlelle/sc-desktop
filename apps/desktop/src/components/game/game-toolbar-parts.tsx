import { useMemo } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";
import { IS_MACOS } from "@/lib/platform";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { GameTabPicker } from "./game-tab-picker";
import { setGamePickerOpen, useGamePickerOpen, useGameTabActions } from "./use-game-tab-actions";

/** Where a game goes back to when nothing was before it (the app started on it, a reload): the Library. */
export const GAMES_FALLBACK = { label: "Games", path: "/matches" } as const;


/**
 * The game's title in its toolbar. With the sidebar shown it is the title, nothing more: the open games are
 * the sidebar's rows. With the sidebar hidden those rows are out of sight, so the title becomes their menu
 * (as Xcode's jump bar is): the open games, the one on screen checked, and New Tab, which opens the game
 * picker under the title. No new row, no new button.
 */
export function GameTitle({ title }: { title: string }) {
  const collapsed = useSidebarCollapsed();
  const { activeOrgId } = useAuth();
  const { matchId, tabs, goTo, pick } = useGameTabActions();
  const picking = useGamePickerOpen();
  const openIds = useMemo(() => new Set(tabs.tabs.map((t) => t.id)), [tabs.tabs]);
  if (!collapsed) return <>{title}</>;
  return (
    <GameTabPicker open={picking} onOpenChange={setGamePickerOpen} orgId={activeOrgId} openIds={openIds} onPick={pick} anchor>
      <span className="inline-flex min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 text-left outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 data-[state=open]:bg-fill-1 focus-visible:ring-2 focus-visible:ring-selection"
            >
              <span className="truncate">{title}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Open games</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {tabs.tabs.map((tab) => (
              <DropdownMenuItem key={tab.id} onSelect={() => goTo(tab.id, "title_menu")}>
                <Check className={tab.id === matchId ? "opacity-100" : "opacity-0"} aria-hidden />
                <span className="truncate">{tab.title || "Loading…"}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              // The menu closes first, then the picker opens where the title is.
              onSelect={() => window.setTimeout(() => setGamePickerOpen(true), 0)}
            >
              New Tab…
              <DropdownMenuShortcut>{IS_MACOS ? "⌘T" : "Ctrl+T"}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </GameTabPicker>
  );
}
