import { Outlet, useLocation } from "react-router-dom";
import { GameTabBar } from "@/components/game/game-tab-bar";
import { Sidebar } from "@/components/shell/sidebar";
import { LicenseBanner } from "@/components/license-banner";
import { TeamStep } from "@/components/team-step";

/**
 * The window: a source-list sidebar beside the content column. Pages built
 * on `Page`/`Toolbar`/`PageContent` own their scrolling; older pages still
 * scroll in the column itself. No page transition: a source-list app swaps
 * content in place, and the sidebar selection plus the toolbar title say
 * where you are. The key resets scroll position between pages.
 */
export function RootLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex h-screen overflow-hidden font-sans antialiased">
      <Sidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <LicenseBanner />
        {/* The game page's tabs, above the page and outside its key: the page is built again for every game,
            the bar is not, so a tab that is pressed can be dragged on. */}
        <GameTabBar />
        <div key={pathname} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
      </main>
      <TeamStep />
    </div>
  );
}
