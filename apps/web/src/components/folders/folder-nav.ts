/**
 * Where the Playlists page is, as a URL: `?folder=<id>` for a folder, so
 * Back, reloads and shared links land in the same place. The top level is
 * the plain page, called "Playlists".
 */
export const FOLDER_PARAM = "folder";

export const TOP_LEVEL_NAME = "Playlists";

/** The Playlists page at a folder; null or undefined is the top level. */
export function playlistsHref(folderId?: string | null): string {
  return folderId ? `/playlists?${FOLDER_PARAM}=${encodeURIComponent(folderId)}` : "/playlists";
}

/**
 * Opens a folder on the Playlists page without a trip to the server: the
 * page already holds every folder, and Next keeps useSearchParams in step
 * with the History API, so this is instant where router.push would wait for
 * the server to render the page again. Going into a folder starts at its
 * top; `replace` corrects the URL without a new history entry.
 */
export function goToFolder(folderId: string | null, opts: { replace?: boolean } = {}): void {
  const href = playlistsHref(folderId);
  if (opts.replace) {
    window.history.replaceState(null, "", href);
    return;
  }
  window.history.pushState(null, "", href);
  window.scrollTo(0, 0);
}

/** A folder shown before the database has handed back its id carries this prefix. */
export const PENDING_FOLDER_PREFIX = "pending-";

export function isPendingFolder(id: string): boolean {
  return id.startsWith(PENDING_FOLDER_PREFIX);
}

/** "1 playlist", "3 playlists". */
export function playlistCountLabel(count: number): string {
  return `${count} playlist${count === 1 ? "" : "s"}`;
}
