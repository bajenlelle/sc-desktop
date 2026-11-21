import { motion } from "framer-motion";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, FileText, Film, ListPlus, ListVideo, Plus, Search, Share2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { UpdateCard } from "@/components/UpdateChecker";
import { useAuth } from "@/lib/auth-context";
import { useImportQuota } from "@/lib/use-import-quota";
import { IS_MACOS } from "@/lib/platform";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { toggleBrowser } from "@/lib/playlist-browser-store";
import { openQuickSearch } from "@/lib/quick-search-store";
import { cn } from "@/lib/utils";
import { sidebarPages, type GoPage } from "@scoutable/shared/lib/menu-shortcuts";
import { useHeadingToGame } from "@/components/game/use-game-tab-actions";
import { gameTabsScope, useGameTabs } from "@/lib/game-tabs";
import { GettingStartedCard } from "./getting-started-card";
import { OpenGames } from "./open-games";
import { SpaceSwitcher } from "./space-switcher";
import { UserMenu } from "./user-menu";

/** Keep in step with --sidebar-width in index.css. */
const SIDEBAR_WIDTH = 220;

/** The action rows above the pages (New playlist, Search): a page row's look, never selected. */
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
        }
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

/**
 * The macOS source list: labelled rows, the space at the top, the account
 * at the bottom, the traffic lights inset in the strip above it all. On
 * macOS the system paints vibrancy behind it; on Windows it is an opaque
 * column with a separator. Collapsing animates the width with a spring.
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
  const reduced = useReducedMotionSafe();
  const importQuota = useImportQuota();

  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const ready = !!user && !profileLoading;
  // A game that is open is selected as its own row under Open games, not as the Library.
  const openGames = useGameTabs(gameTabsScope(user?.id, activeOrgId));
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
        return <NavItem key={page} to="/teams" icon={Shield} label="Teams" active={pathname.startsWith("/teams")} />;
    }
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH }}
      transition={reduced ? { duration: 0 } : springs.standard}
      aria-hidden={collapsed || undefined}
      className={cn(
        "relative h-screen shrink-0 overflow-hidden select-none",
        IS_MACOS ? "bg-material-sidebar" : "border-r border-separator bg-sidebar",
      )}
    >
      {/* Fixed inner width so the content never reflows while the width springs. */}
      <div className="flex h-full flex-col" style={{ width: SIDEBAR_WIDTH }}>
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

        {/* The two actions a coach takes most, above the pages: New playlist, then the search over the
            space, where Notion and Mail keep theirs. Buttons, not destinations, so never selected:
            New playlist does what ⌘N does (pages/playlists.tsx takes `createNew` also while it is open),
            Search opens the panel (components/search/quick-search.tsx). */}
        {ready && isCoachOrAdmin && (
          <div className="mt-3 flex flex-col gap-0.5 px-2">
            <button
              type="button"
              onClick={() => navigate("/playlists", { state: { createNew: true } })}
              aria-label="New playlist"
              aria-keyshortcuts={IS_MACOS ? "Meta+N" : "Control+N"}
              className={ACTION_ROW}
            >
              <ListPlus className="size-4 shrink-0 text-primary" />
              <span className="truncate">New playlist</span>
              <Kbd aria-hidden className="ml-auto">{IS_MACOS ? "\u2318N" : "Ctrl N"}</Kbd>
            </button>
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

        {/* The games open on this computer, from any page (components/shell/open-games.tsx). */}
        {ready && <OpenGames />}

        {/* The one action a coach reaches for from any page, under the list as in Reminders' "Add List":
            the same link as the Library's Import game button (the import page gates licenses and roles). */}
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

        <div className="mt-auto flex flex-col gap-2 p-2">
          {/* New signups' checklist, until it's done or dismissed (getting-started-card.tsx). */}
          {ready && <GettingStartedCard />}
          <UpdateCard />
          {user && <UserMenu user={user} />}
        </div>
      </div>
    </motion.aside>
  );
}
