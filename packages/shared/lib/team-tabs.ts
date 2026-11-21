/**
 * The desktop's open teams (rows in the sidebar's Open teams, docs/teams.md):
 * the same rules as the open games (lib/game-tabs.ts: order, most recently
 * shown, the cap, parsing), keyed by a team's season and team.
 */

/** An open team's id: its season (competition) and team, "4121:7". */
export function teamTabId(competitionId: number, teamId: number): string {
  return `${competitionId}:${teamId}`;
}

/** The team page an open team's id leads to; null for an id that isn't one. */
export function teamTabPath(id: string): string | null {
  const m = /^(\d+):(\d+)$/.exec(id);
  return m ? `/teams/${m[1]}/${m[2]}` : null;
}

/** The open team a page is, from its path; null for any other page. */
export function teamTabOfPath(pathname: string): string | null {
  const m = /^\/teams\/(\d+)\/(\d+)$/.exec(pathname);
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * What of a team page's router state a row of Open teams brings back: the
 * side and the pick, and Back only while it leads to a team page or the
 * league (a game it once led to may be closed, deleted or moved since). How
 * the page was first opened (`from`, `playsFrom`) is not brought back: the
 * row is a new way in.
 */
export function teamStateToRestore(state: unknown): { side?: unknown; pick?: unknown; back?: { label: string; path: string } } {
  if (!state || typeof state !== "object") return {};
  const { side, pick, back } = state as { side?: unknown; pick?: unknown; back?: { label?: unknown; path?: unknown } };
  const out: { side?: unknown; pick?: unknown; back?: { label: string; path: string } } = {};
  if (side !== undefined) out.side = side;
  if (pick !== undefined) out.pick = pick;
  if (back && typeof back.label === "string" && typeof back.path === "string" && /^\/teams(\/|$)/.test(back.path)) out.back = { label: back.label, path: back.path };
  return out;
}
