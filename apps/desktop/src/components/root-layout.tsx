import { useRef } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import { GameTabKeys } from "@/components/game/game-tab-keys";
import { QuickSearchHost } from "@/components/search/quick-search-host";
import { Sidebar } from "@/components/shell/sidebar";
import { LicenseBanner } from "@/components/license-banner";
import { TeamStep } from "@/components/team-step";
import { useRememberLastPage } from "@/lib/last-page";
import { useTrackNavHistory } from "@/lib/nav-history";

/**
 * The window: a source-list sidebar beside the content column. Pages built
 * on `Page`/`Toolbar`/`PageContent` own their scrolling; older pages still
 * scroll in the column itself. No page transition: a source-list app swaps
 * content in place, and the sidebar selection plus the toolbar title say
 * where you are. The key resets scroll position between pages. It notes the
 * page as the one to reopen on the next start (lib/last-page.ts).
 */
export function RootLayout() {
  const { pathname } = useLocation();
  useRememberLastPage();
  // First, so the page rendered for a location already finds its entry in the history (lib/nav-history.ts).
  const entryId = useTrackNavHistory()?.id ?? 0;
  const action = useNavigationType();
  // A page is mounted per path. Back or Forward to another visit of the same path (the editor opened again from
  // the search, then ⌘[) mounts it afresh too, so it comes back as that visit left it (lib/page-memory.ts); a
  // push to the path on screen, which the page handles in place, doesn't.
  const mount = useRef({ pathname, entryId, n: 0 });
  const was = mount.current;
  if (was.pathname !== pathname) mount.current = { pathname, entryId, n: was.n };
  else if (was.entryId !== entryId) mount.current = { pathname, entryId, n: action === "POP" ? was.n + 1 : was.n };
  return (
    <div className="flex h-screen overflow-hidden font-sans antialiased">
      <Sidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <LicenseBanner />
        <div key={`${pathname}#${mount.current.n}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
          <Outlet />
        </div>
      </main>
      <TeamStep />
      {/* The open games' keys and menu items, from any page (the games are the sidebar's Open games). */}
      <GameTabKeys />
      {/* The search over the space: ⌘K, Ctrl+K or the sidebar's Search (docs/search.md). */}
      <QuickSearchHost />
    </div>
  );
}
