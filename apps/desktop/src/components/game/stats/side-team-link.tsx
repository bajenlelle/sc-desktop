import * as React from "react";
import { TeamLink, type TeamTarget } from "@/components/entity-link";

/**
 * Where the game's two teams' pages are, once the season is in (the game's competition and the season's team
 * ids): every name of a team in Stats opens its page through it (docs/navigation.md).
 */
export interface GameTeams {
  home: TeamTarget | null;
  away: TeamTarget | null;
}

const GameTeamsContext = React.createContext<GameTeams>({ home: null, away: null });

export const GameTeamsProvider = GameTeamsContext.Provider;

export function useGameTeams(): GameTeams {
  return React.useContext(GameTeamsContext);
}

/** The game's home (1) or away (2) team by name, opening its page; plain text until the season is in. */
export function SideTeamLink({ side, name, className }: { side: 1 | 2; name: string; className?: string }) {
  const teams = useGameTeams();
  return (
    <TeamLink team={side === 1 ? teams.home : teams.away} name={name} state={{ from: "game" }} className={className}>
      {name}
    </TeamLink>
  );
}
