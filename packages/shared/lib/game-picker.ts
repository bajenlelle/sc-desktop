/**
 * The game picker behind the "+" of the desktop game page's tab bar: which of
 * the Library's games it lists for what has been typed, and which of them
 * already have a tab.
 */

/** As much of a Library game as the picker reads. */
export interface PickerGame {
  id: string;
  title: string;
  date?: string | null;
  homeTeam: { name: string };
  awayTeam: { name: string };
  /** Archived games are left out of the Library, and of the picker. */
  archivedAt?: string | null;
}

export interface PickableGame {
  id: string;
  title: string;
  date: string | null;
  /** The game already has a tab: choosing it goes to that tab. */
  open: boolean;
}

/**
 * The picker's rows, in the order the Library lists its games (the one
 * imported last comes first). What is typed is looked for in the title and in
 * both teams' names, as the Library's own search does, in any case.
 */
export function pickableGames(games: readonly PickerGame[], query: string, openIds: ReadonlySet<string>): PickableGame[] {
  const q = query.trim().toLowerCase();
  return games
    .filter((g) => !g.archivedAt)
    .filter((g) => !q || [g.title, g.homeTeam.name, g.awayTeam.name].some((text) => text.toLowerCase().includes(q)))
    .map((g) => ({ id: g.id, title: g.title, date: g.date || null, open: openIds.has(g.id) }));
}
