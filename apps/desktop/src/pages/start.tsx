import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { startPath } from "@scoutable/shared/lib/start-page";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { gameTabsScope, useGameTabs } from "@/lib/game-tabs";
import { lastPageScope, readLastPage } from "@/lib/last-page";

/**
 * `/`, where the app opens: no page of its own. It sends the coach to the page
 * they were on last in this space when it is still there to open, else to
 * Playlists; a club player to My playlists (`startPath`). Replaced, so Back
 * never returns here. Nothing is decided, and nothing drawn, until the user,
 * the space and the profile are known: a guess would flash the wrong page.
 */
export function StartPage() {
  const { user, profileLoading, activeOrgId, activeOrgIsPersonal, activeOrgRole } = useAuth();
  const tabs = useGameTabs(gameTabsScope(user?.id, activeOrgId)).tabs;
  const known = !profileLoading && !!user && !!activeOrgId;
  const start = known
    ? startPath({
        remembered: readLastPage(lastPageScope(user.id, activeOrgId)),
        openGameIds: tabs.map((t) => t.id),
        clubPlayer: !activeOrgIsPersonal && activeOrgRole === "player",
        personal: activeOrgIsPersonal,
      })
    : null;

  const tracked = useRef(false);
  useEffect(() => {
    if (!start || tracked.current) return;
    tracked.current = true;
    trackEvent("start_page_opened", { page: start.path, restored: start.restored });
  }, [start]);

  if (!start) return null;
  return <Navigate to={start.path} replace />;
}
