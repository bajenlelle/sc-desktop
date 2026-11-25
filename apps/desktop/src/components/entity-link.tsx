import * as React from "react";
import { Link, type LinkProps } from "react-router-dom";
import { toast } from "sonner";
import { teamTabId } from "@scoutable/shared/lib/team-tabs";
import { useAuth } from "@/lib/auth-context";
import { gameTabsScope, rememberGameTab } from "@/lib/game-tabs";
import { rememberTeamTab } from "@/lib/team-tabs";
import { cn } from "@/lib/utils";

/**
 * What names a game or a team opens it, as in Notion or Music's artist and album in a song's row
 * (docs/navigation.md). One look for all of them: the text's own colour, underlined while pointed at or
 * focused, dimmed while pressed (feedback on the press itself, not the release). Back returns from where
 * it was opened (lib/nav-history.ts).
 *
 * Inside a row that plays or selects, only the name is the link: its press is its own, never the row's
 * (no play, no selection, no drag). ⌘-click (Ctrl-click) or the middle button opens the game or team in the
 * sidebar's Open games or Open teams, and leaves the page as it is.
 */
export const ENTITY_LINK =
  "cursor-pointer rounded-sm underline-offset-2 outline-none transition-opacity duration-100 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-selection active:opacity-60";

type Shared = Omit<LinkProps, "to" | "onClick"> & {
  children: React.ReactNode;
  className?: string;
  /** On an open (not a background open), for analytics. */
  onOpen?: () => void;
  /**
   * The page's own way to open it, in place of the link's (the editor's notes where the game's Add collects to):
   * a plain click calls it instead of following the link; ⌘-click still opens it in the sidebar.
   */
  via?: () => void;
};

/** A press on the link is the link's alone. */
function keepFromRow(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function useBackgroundOpen(open: (() => void) | null, onOpen?: () => void, via?: () => void) {
  return {
    onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && open) {
        e.preventDefault();
        open();
        return;
      }
      onOpen?.();
      if (via) {
        e.preventDefault();
        via();
      }
    },
    onAuxClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 1 || !open) return;
      e.preventDefault();
      e.stopPropagation();
      open();
    },
    onPointerDown: keepFromRow,
    onMouseDown: keepFromRow,
    onDoubleClick: keepFromRow,
    // Enter on the link follows it; a row around it that presses on Enter must not play as well.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") e.stopPropagation();
    },
  };
}

/** The path to a game: at a play (`?play=`), or in a view (`?view=`). */
export function gamePath(gameId: string, at?: { play?: number | null; view?: "game" | "stats" | "details" }): string {
  if (at?.play != null) return `/matches/${gameId}?play=${at.play}`;
  if (at?.view) return `/matches/${gameId}?view=${at.view}`;
  return `/matches/${gameId}`;
}

/**
 * A game, by its library id; plain text when the game isn't in the library (`gameId` null). `title` is the
 * game's name for its row in Open games (⌘-click).
 */
export function GameLink({
  gameId,
  title,
  play,
  view,
  children,
  className,
  onOpen,
  via,
  ...rest
}: Shared & { gameId: string | null | undefined; title: string; play?: number | null; view?: "game" | "stats" | "details" }) {
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const open = gameId
    ? () => {
        rememberGameTab(scope, { id: gameId, title, date: null });
        toast(`${title} is in Open games`);
      }
    : null;
  const handlers = useBackgroundOpen(open, onOpen, via);
  if (!gameId) return <span className={className}>{children}</span>;
  return (
    <Link to={gamePath(gameId, { play, view })} className={cn(ENTITY_LINK, className)} {...rest} {...handlers}>
      {children}
    </Link>
  );
}

/** Where a team's page is: its season's page, or found from its league id (`/teams/find/…`). */
export type TeamTarget = { competitionId: number; teamId: number } | { leagueTeamId: string };

export function teamPath(t: TeamTarget): string {
  return "leagueTeamId" in t ? `/teams/find/${t.leagueTeamId}` : `/teams/${t.competitionId}/${t.teamId}`;
}

/** A team; plain text when where its page is isn't known (`team` null). `name` is its row's in Open teams. */
export function TeamLink({
  team,
  name,
  children,
  className,
  onOpen,
  via,
  ...rest
}: Shared & { team: TeamTarget | null | undefined; name: string }) {
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const open =
    team && !("leagueTeamId" in team)
      ? () => {
          rememberTeamTab(scope, teamTabId(team.competitionId, team.teamId), name);
          toast(`${name} is in Open teams`);
        }
      : null;
  const handlers = useBackgroundOpen(open, onOpen, via);
  if (!team) return <span className={className}>{children}</span>;
  return (
    <Link to={teamPath(team)} className={cn(ENTITY_LINK, className)} {...rest} {...handlers}>
      {children}
    </Link>
  );
}
