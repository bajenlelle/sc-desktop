import type { PlayByPlayEvent } from "../types/match";

/**
 * The short name a play row shows for the play's team when a list holds both
 * teams' plays ("SÖD"): the feed's code, else the first three letters of the
 * team's name, upper case. Null for a play with no team (a timeout).
 */
export function teamCode(e: PlayByPlayEvent): string | null {
  const team = e.eventTeam;
  if (!team) return null;
  const code = team.teamCode?.trim();
  if (code) return code;
  const letters = Array.from(team.teamName ?? "").filter((c) => /\p{L}/u.test(c));
  return letters.length > 0 ? letters.slice(0, 3).join("").toUpperCase() : null;
}
