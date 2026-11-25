import * as React from "react";
import { motion } from "framer-motion";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { markNextNavRoot } from "@/lib/nav-history";
import { BookOpen, FileText, Film, ListVideo, Plus, Search, Share2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UpdateCard } from "@/components/UpdateChecker";
import { useAuth } from "@/lib/auth-context";
import { useImportQuota } from "@/lib/use-import-quota";
import { IS_MACOS } from "@/lib/platform";
import { setSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar-store";
import { setSidebarWidth, SIDEBAR_WIDTH, useSidebarWidth } from "@/lib/sidebar-width";
import { useColumnResize } from "@/lib/use-column-resize";
import { toggleBrowser } from "@/lib/playlist-browser-store";
import { openQuickSearch } from "@/lib/quick-search-store";
import { cn } from "@/lib/utils";
import { sidebarPages, type GoPage } from "@scoutable/shared/lib/menu-shortcuts";
import { useHeadingToGame } from "@/components/game/use-game-tab-actions";
import { gameTabsScope, useGameTabs } from "@/lib/game-tabs";
import { teamTabOfPath } from "@scoutable/shared/lib/team-tabs";
import { useTeamTabs } from "@/lib/team-tabs";
import { GettingStartedCard } from "./getting-started-card";
import { OpenGames } from "./open-games";
import { OpenTeams } from "./open-teams";
import { SpaceSwitcher } from "./space-switcher";
import { UserMenu } from "./user-menu";

/** The action row above the pages (Search): a page row's look, never selected. */
const ACTION_ROW =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection";

function NavItem({
  to,
  icon: Icon,
  label,
  active,
  onClickWhileActive,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClickWhileActive?: () => void;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (active && onClickWhileActive) {
          e.preventDefault();
          onClickWhileActive();
          return;
        }
        // A page of the sidebar's is a fresh start: no "‹ {page}" back in its toolbar (⌘[ still goes back). Only for
        // the click that navigates here: a modified one leaves it to the system, and the mark would land elsewhere.
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) markNextNavRoot();
      }}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-sm font-medium outline-none transition-[background-color,transform] duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-selection",
        active
          ? "bg-row-selected text-foreground"
          : "text-foreground hover:bg-fill-1 active:bg-fill-2",
      )}
    >
      <Icon className="size-4 shrink-0 text-primary" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** How far the scroll-edge fade reaches into the list, in px. */
const EDGE_FADE = 12;

/**
 * Which ends of a scroller have content hidden past them, kept current as it
 * scrolls and as it or its content changes size (an open game added, the
 * window made shorter).
 */
function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
  const [edges, setEdges] = React.useState({ top: false, bottom: false });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 0;
      // A pixel of slack: fractional heights can leave scrollTop just short of the end.
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [ref]);
  return edges;
}

/** A mask that fades the list out under whichever edge has more past it. */
function edgeMask({ top, bottom }: { top: boolean; bottom: boolean }): React.CSSProperties | undefined {
  if (!top && !bottom) return undefined;
  const image = `linear-gradient(to bottom, ${top ? "transparent" : "black"}, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), ${bottom ? "transparent" : "black"})`;
  return { WebkitMaskImage: image, maskImage: image };
}

/**
 * The macOS source list: labelled rows, the space at the top, the account
 * at the bottom, the traffic lights inset in the strip above it all. On
 * macOS the system paints vibrancy behind it; on Windows it is an opaque
 * column with a separator. Its right edge drags it wider or narrower, as
 * Mail's and Notion's do (lib/use-column-resize.ts): the width is kept per
 * machine (lib/sidebar-width.ts), and hiding or showing it is one spring of
 * the width. A click on the edge hides it, and shows it again at the width
 * it had; a flick inward hides it too, and then it comes back at the default
 * width. Hidden, the window's left edge is its edge: a click or a pull brings
 * it out. Hovered, the edge lights up as a blue line: the window's one
 * accented divider; the inner ones are gray.
 * The space and the account stay put; everything between them scrolls when
 * the window is too short for it, as Finder's and Mail's lists do, fading
 * out at an edge only while there is more past it.
 */
export function Sidebar() {
  const {
    user,
    profileLoading,
    myOrgs,
    activeOrg,
    activeOrgId,
    activeOrgRole,
    activeOrgIsPersonal,
    setActiveOrg,
  } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const collapsed = useSidebarCollapsed();
  const width = useSidebarWidth();
  /** The edge's "Hide sidebar"/"Show sidebar" label. */
  const [tipOpen, setTipOpen] = React.useState(false);
  /** A drag keeps the label away until the pointer comes back onto the edge afresh (as the playlist browser's). */
  const tipSuppressed = React.useRef(false);
  const { w, innerW, dragMode, edgeProps } = useColumnResize({
    collapsed,
    width,
    limits: SIDEBAR_WIDTH,
    onWidthChange: setSidebarWidth,
    // Dragged shut, it comes back at the default width: the width it was dragged through says nothing.
    onCollapse: () => {
      setSidebarWidth(SIDEBAR_WIDTH.default);
      setSidebarCollapsed(true);
    },
    // A click on the open edge hides it and keeps its width for when it comes back.
    onEdgeClick: () => setSidebarCollapsed(true),
    // From the hidden edge: a click opens at the kept width, a pull at the width it was pulled to.
    onExpand: (next) => {
      setSidebarWidth(next);
      setSidebarCollapsed(false);
    },
    onDragStart: () => {
      tipSuppressed.current = true;
      setTipOpen(false);
    },
  });
  const importQuota = useImportQuota();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const edges = useScrollEdges(scrollRef);

  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const ready = !!user && !profileLoading;
  // A game that is open is selected as its own row under Open games, not as the Library.
  const openGames = useGameTabs(gameTabsScope(user?.id, activeOrgId));
  // So is a team that is open, under Open teams, not as Teams.
  const openTeams = useTeamTabs(gameTabsScope(user?.id, activeOrgId));
  const shownTeam = teamTabOfPath(pathname);
  const teamsActive = pathname.startsWith("/teams") && !(shownTeam && openTeams.tabs.some((t) => t.id === shownTeam));
  const shownGame = /^\/matches\/([^/]+)$/.exec(pathname)?.[1];
  // A switch on its way to an open game selects that game's row from the click, not the Library meanwhile.
  const headingTo = useHeadingToGame();
  const libraryActive = !headingTo && pathname.startsWith("/matches") && !(shownGame && openGames.tabs.some((t) => t.id === shownGame));

  const row = (page: GoPage) => {
    switch (page) {
      case "go-playlists":
        return (
          <NavItem
            key={page}
            to="/playlists"
            icon={ListVideo}
            label="Playlists"
            active={pathname.startsWith("/playlists") && !pathname.startsWith("/my-playlists")}
            onClickWhileActive={toggleBrowser}
          />
        );
      case "go-reports":
        return <NavItem key={page} to="/reports" icon={FileText} label="Reports" active={pathname.startsWith("/reports")} />;
      case "go-my-playlists":
        return (
          <NavItem
            key={page}
            to="/my-playlists"
            icon={isCoachOrAdmin ? Share2 : BookOpen}
            label={isCoachOrAdmin ? "Shared playlists" : "My playlists"}
            active={pathname.startsWith("/my-playlists")}
          />
        );
      case "go-library":
        return <NavItem key={page} to="/matches" icon={Film} label="Games" active={libraryActive} />;
      case "go-teams":
        return <NavItem key={page} to="/teams" icon={Shield} label="Teams" active={teamsActive} />;
    }
  };

  return (
    <motion.aside
      style={{ width: w }}
      className={cn(
        "relative h-screen shrink-0 select-none",
        IS_MACOS ? "bg-material-sidebar" : "border-r border-separator bg-sidebar",
      )}
    >
      <div className="h-full overflow-hidden" aria-hidden={collapsed || undefined}>
      {/* The content keeps its width while the column springs, so nothing re-wraps; dragged, it follows the edge. */}
      <motion.div className="flex h-full flex-col" style={{ width: innerW }}>
        <div
          data-tauri-drag-region
          className={cn("shrink-0", IS_MACOS ? "h-[var(--titlebar-inset)]" : "h-3")}
        />

        {ready && activeOrg && (
          <SpaceSwitcher
            org={activeOrg}
            myOrgs={myOrgs}
            setActiveOrg={setActiveOrg}
            importQuota={importQuota}
          />
        )}

        {/* The scrolling middle. The open games' and teams' drag scrolls it at its edges (it finds it by
            `data-sidebar-scroll`). Its inner column is at least as tall as the scroller, so the cards below
            sit at the bottom while there is room and scroll with the rest when there is not. */}
        <div
          ref={scrollRef}
          data-sidebar-scroll
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
          style={edgeMask(edges)}
        >
        <div className="flex min-h-full flex-col">
        {/* The search over the space, above the pages, where Notion and Mail keep theirs. A button, not a
            destination, so never selected: it opens the panel (components/search/quick-search.tsx). New
            playlist is not here: it sits in the playlist list's header, and ⌘N works from any page. */}
        {ready && isCoachOrAdmin && (
          <div className="mt-3 flex flex-col gap-0.5 px-2">
            <button
              type="button"
              onClick={() => openQuickSearch("sidebar")}
              aria-label="Search"
              aria-keyshortcuts={IS_MACOS ? "Meta+K" : "Control+K"}
              className={ACTION_ROW}
            >
              <Search className="size-4 shrink-0 text-primary" />
              <span className="truncate">Search</span>
              <Kbd aria-hidden className="ml-auto">{IS_MACOS ? "\u2318K" : "Ctrl K"}</Kbd>
            </button>
          </div>
        )}

        {/* The rows come from one list (`sidebarPages`), the one the Go menu's number keys follow:
            ⌘n, or Ctrl+n, opens the nth row shown here. */}
        {ready && (
          <nav aria-label="Main" className={cn("flex flex-col gap-0.5 px-2", isCoachOrAdmin ? "mt-0.5" : "mt-3")}>
            {sidebarPages({ staff: isCoachOrAdmin, personal: activeOrgIsPersonal }).map(row)}
          </nav>
        )}

        {/* The one action a coach reaches for from any page, under the pages and above the open games and
            teams, so it stays in one place however many are open: the same link as the Games page's Import
            game button (the import page gates licenses and roles). */}
        {ready && isCoachOrAdmin && (
          <div className="mt-2 px-2">
            <Button variant="ghost" size="sm" asChild className="w-full justify-start px-2 has-[>svg]:px-2">
              <Link to="/upload">
                <Plus className="text-primary" />
                Import game
              </Link>
            </Button>
          </div>
        )}

        {/* The games open on this computer, from any page (components/shell/open-games.tsx). */}
        {ready && <OpenGames />}

        {/* The teams visited, after the games (components/shell/open-teams.tsx). */}
        {ready && <OpenTeams />}

        {/* New signups' checklist, until it's done or dismissed (getting-started-card.tsx), and the update
            card: tall, so they scroll with the list rather than squeeze it. */}
        <div className="mt-auto flex flex-col gap-2 px-2 pt-4 empty:hidden">
          {ready && <GettingStartedCard />}
          <UpdateCard />
        </div>
        </div>
        </div>

        <div className="shrink-0 p-2">{user && <UserMenu user={user} />}</div>
      </motion.div>
      </div>

      {/* The edge. Open, a hit area straddling the sidebar's right edge, above the content beside it. Hidden, it moves
          wholly onto the window's left edge, so it is there to hover, click or pull. One element both ways, so its line
          never doubles up while the sidebar opens or closes under the pointer. */}
      <Tooltip open={tipOpen && !dragMode} onOpenChange={(open) => setTipOpen(open && !tipSuppressed.current)}>
        <TooltipTrigger asChild>
          <div
            {...edgeProps}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-keyshortcuts={IS_MACOS ? "Control+Meta+S" : undefined}
            onPointerEnter={() => {
              if (!dragMode) tipSuppressed.current = false;
            }}
            className={cn(
              "group/edge absolute inset-y-0 z-30 cursor-col-resize outline-none",
              collapsed ? "left-0 w-2" : "-right-1.5 w-3",
            )}
          >
            <div
              data-edge-line
              className={cn(
                "absolute inset-y-0 w-0.5 bg-selection transition-opacity duration-150 motion-reduce:transition-none group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100",
                collapsed ? "left-0" : "left-1/2 -translate-x-1/2",
                dragMode ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-1.5">
          {collapsed ? "Show sidebar" : "Hide sidebar"}
          {IS_MACOS && <Kbd>{"\u2303\u2318S"}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </motion.aside>
  );
}
