import { Outlet, useLocation } from "react-router-dom";
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
        <div key={pathname} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
      </main>
      <TeamStep />
    </div>
  );
}
