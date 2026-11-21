import { useMemo } from "react";
import { Plus } from "lucide-react";
import { tabTitleParts } from "@scoutable/shared/lib/game-tabs";
import { GameTabPicker } from "@/components/game/game-tab-picker";
import { setGamePickerOpen, useGamePickerOpen, useGameTabActions, useHeadingToGame } from "@/components/game/use-game-tab-actions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format-date";
import { reorderGameTabs } from "@/lib/game-tabs";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { IS_MACOS } from "@/lib/platform";
import { OpenTabRows } from "./open-tab-rows";

/** The + after the caption, with its tooltip; the picker's trigger hands it its props and ref. */
function OpenAnotherButton(props: React.ComponentProps<"button">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Open another game"
          {...props}
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-95 active:bg-fill-3 data-[state=open]:bg-fill-2 data-[state=open]:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
        >
          <Plus className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        Open another game <span className="text-muted-foreground">{IS_MACOS ? "⌘T" : "Ctrl T"}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** "Fryshuset Bask… vs AIK": each team cut short by itself, so two games of the same home team don't read the same. */
function GameName({ title }: { title: string }) {
  const parts = tabTitleParts(title);
  if (!title) return <span className="min-w-0 truncate text-muted-foreground">Loading…</span>;
  if (!parts) return <span className="min-w-0 truncate">{title}</span>;
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate">{parts.home}</span>
      <span className="shrink-0 whitespace-pre"> vs </span>
      <span className="min-w-0 truncate">{parts.away}</span>
    </span>
  );
}

/**
 * The open games, as the sidebar's second list (the way VS Code's Open Editors and Arc's tabs sit beside the
 * content): there from any page, so a game left for a playlist is one click away, as it was left. Under a
 * caption with a + that opens another game (the picker, as New Tab ⌘T does). The game on screen is the
 * selected row, and the Library row is not. The titles start at the caption's edge: a row has no icon. The
 * rows themselves (open, close, drag, keys) are the sidebar's open-tab list (./open-tab-rows.tsx). Selecting
 * follows the click at once, before the game's page has drawn. The game on screen when it is the only one
 * can't be closed (there is no game to give the page to: the toolbar's back button leaves the game).
 */
export function OpenGames() {
  const { activeOrgId } = useAuth();
  const { matchId, scope, tabs, goTo, close, canClose, closeOthers, pick } = useGameTabActions();
  // The game a switch is on its way to is the one selected, from the click (use-game-tab-actions.ts).
  const headingTo = useHeadingToGame();
  const shownId = headingTo ?? matchId;
  // With the sidebar hidden the picker opens at the game's title instead (components/game/game-toolbar-parts.tsx).
  const pickerOpen = useGamePickerOpen();
  const collapsed = useSidebarCollapsed();
  const picking = pickerOpen && !collapsed;
  const storeIds = tabs.tabs.map((t) => t.id);
  const openIds = useMemo(() => new Set(storeIds), [storeIds.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OpenTabRows
      label="Open games"
      action={
        <GameTabPicker open={picking} onOpenChange={setGamePickerOpen} orgId={activeOrgId} openIds={openIds} onPick={pick} side="right">
          <OpenAnotherButton />
        </GameTabPicker>
      }
      rows={tabs.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        name: <GameName title={tab.title} />,
        tooltip: (
          <>
            <span>{tab.title || "Loading…"}</span>
            {tab.date && <span className="text-muted-foreground nums">{formatDate(tab.date, "medium")}</span>}
          </>
        ),
      }))}
      shownId={shownId}
      canClose={canClose}
      onChoose={(id) => goTo(id, "sidebar")}
      onClose={close}
      onCloseOthers={closeOthers}
      onReorder={(order) => {
        reorderGameTabs(scope, order);
        trackEvent("game_tabs_reordered", { tabs: order.length });
      }}
      rowData={{ "data-open-game": "" }}
    />
  );
}
