/**
 * Where the desktop opens now that Home is gone: the page the coach left on
 * if it is still worth reopening, else Playlists (a club player gets My
 * playlists). Pure: the desktop stores the remembered path and wires this in.
 * Spec: docs/superpowers/specs/2026-11-21-retire-home-design.md.
 */

const PLAYLISTS = "/playlists";
const MY_PLAYLISTS = "/my-playlists";
const MATCHES = "/matches";

const PLAIN_PATHS: readonly string[] = [PLAYLISTS, "/reports", MY_PLAYLISTS, MATCHES, "/teams"];

/** `/matches/:id` or `/teams/:competitionId/:teamId`; `/teams/find/:id` is not a team page. */
const GAME_PATH = /^\/matches\/[^/]+$/;
const TEAM_PATH = /^\/teams\/(?!find\/)[^/]+\/[^/]+$/;

/** The path when it is a page worth reopening on the next start, else null. */
export function rememberablePath(pathname: string): string | null {
  if (PLAIN_PATHS.includes(pathname) || GAME_PATH.test(pathname) || TEAM_PATH.test(pathname)) return pathname;
  return null;
}

export interface StartInput {
  /** What rememberablePath kept last time, if anything. */
  remembered: string | null;
  /** The games open in the sidebar now. */
  openGameIds: readonly string[];
  /** A player in a club space: they open on My playlists. */
  clubPlayer: boolean;
  /** A personal space has no My playlists. */
  personal: boolean;
}

/** Where to open. `restored` is true when that is the remembered page. */
export function startPath(input: StartInput): { path: string; restored: boolean } {
  const { remembered, openGameIds, clubPlayer, personal } = input;
  if (clubPlayer) return { path: MY_PLAYLISTS, restored: false };
  const kept = remembered ? rememberablePath(remembered) : null;
  if (!kept) return { path: PLAYLISTS, restored: false };
  if (kept === MY_PLAYLISTS && personal) return { path: PLAYLISTS, restored: false };
  if (GAME_PATH.test(kept) && !openGameIds.includes(kept.slice(MATCHES.length + 1))) return { path: MATCHES, restored: false };
  return { path: kept, restored: true };
}
