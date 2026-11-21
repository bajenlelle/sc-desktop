import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { teamStateToRestore, teamTabOfPath, teamTabPath } from "@scoutable/shared/lib/team-tabs";
import { leaveField } from "@/components/game/use-game-tab-actions";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { gameTabsScope } from "@/lib/game-tabs";
import { closeOtherTeamTabs, forgetTeamTab, recallTeamLeft, reorderTeamTabs, useTeamTabs } from "@/lib/team-tabs";
import type { TeamPageState } from "@/pages/team";
import { OpenTabRows, type TabCloseVia } from "./open-tab-rows";

/**
 * The open teams, the sidebar's list after the open games (docs/teams.md, "Open teams"): every team whose
 * page was visited, so a coach scouting two or three opponents goes back and forth in one click. A row
 * opens its team as it was left (Season or Plays, the side, the pick). The team on screen is the selected
 * row, and the Teams row is not. Closing the team on screen goes to the next open team, the last to Teams.
 * No + and no keys of their own: Teams is the row above, and the tab keys are the games'.
 */
export function OpenTeams() {
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const tabs = useTeamTabs(scope);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const shownId = teamTabOfPath(pathname);

  const go = useCallback(
    (id: string, replace = false) => {
      const path = teamTabPath(id);
      if (!path) return;
      const was = recallTeamLeft(id);
      const state = { ...(teamStateToRestore(was?.state) as Pick<TeamPageState, "side" | "pick" | "back">), from: "open_teams" } satisfies TeamPageState;
      // A field being typed in saves on blur, and the row's press keeps the focus where it was.
      leaveField();
      navigate(`${path}${was?.search ?? ""}`, { replace, state });
    },
    [navigate],
  );

  const close = (id: string, via: TabCloseVia) => {
    // The row after it, else the one before: where the team on screen gives way to.
    const at = tabs.tabs.findIndex((t) => t.id === id);
    const next = tabs.tabs[at + 1]?.id ?? tabs.tabs[at - 1]?.id ?? null;
    forgetTeamTab(scope, id);
    trackEvent("team_tab_closed", { via, tabs: tabs.tabs.length - 1 });
    if (id !== shownId) return;
    if (next) go(next, true);
    else navigate("/teams", { replace: true });
  };

  const closeOthers = (keepId: string) => {
    closeOtherTeamTabs(scope, keepId);
    trackEvent("team_tab_closed", { via: "close_others", tabs: 1 });
    // Only from an open team's page: a team without a row (the season doesn't list it) stays on screen.
    if (shownId && shownId !== keepId && tabs.tabs.some((t) => t.id === shownId)) go(keepId, true);
  };

  return (
    <OpenTabRows
      label="Open teams"
      rows={tabs.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        name: tab.title ? <span className="min-w-0 truncate">{tab.title}</span> : <span className="min-w-0 truncate text-muted-foreground">Loading…</span>,
        tooltip: <span>{tab.title || "Loading…"}</span>,
      }))}
      shownId={shownId}
      canClose={() => true}
      noun="team"
      onChoose={(id) => go(id)}
      onClose={close}
      onCloseOthers={closeOthers}
      onReorder={(order) => {
        reorderTeamTabs(scope, order);
        trackEvent("team_tabs_reordered", { tabs: order.length });
      }}
    />
  );
}
