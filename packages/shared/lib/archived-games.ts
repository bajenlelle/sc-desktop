/**
 * Which games the desktop's Add clips sheet lists once some are archived.
 * Archiving takes a game out of the coach's way, so the sheet leaves archived
 * games out, with three exceptions: the game a "Build a playlist" came from
 * (the coach asked for it by name), a game the open playlist already holds
 * clips from (adding the next round of clips from it must not need an
 * unarchive first), and every game when all of them are archived (an empty
 * sheet would be a dead end). Pure: the sheet and the tests share it.
 */

export function addClipsGames<T extends { id: string; archivedAt?: string }>(
  matches: readonly T[],
  fromId: string | null,
  playlistGameIds: ReadonlySet<string>,
): T[] {
  const shown = matches.filter((m) => !m.archivedAt || m.id === fromId || playlistGameIds.has(m.id));
  return shown.length > 0 ? shown : [...matches];
}
