/**
 * Next-action hero for the desktop Home page: one function decides the single
 * most useful thing to do at every lifecycle stage, so the page keeps a CTA
 * long after the Getting Started checklist is gone (only new signups ever see
 * the checklist — existing accounts were backfilled as dismissed).
 *
 * Mirrors the shape of playlist-feed.ts's computeHero: this returns a
 * discriminated kind + the data needed to act; the component owns the copy.
 */

export interface HomeHeroPlaylist {
  id: string;
  name: string;
  /** Playable clips (playableClips().length) — NOT items.length. */
  clipCount: number;
}

export interface HomeHeroInput {
  /** Imported games excluding the seeded sample game. */
  ownGameCount: number;
  /** The sample game's match id when present in the ACTIVE space (seeded
   * per space: personal always, clubs for staff). */
  demoMatchId: string | null;
  /** Own playlists, newest first (listPlaylists order). */
  playlists: HomeHeroPlaylist[];
  /** Club space = sharing exists; personal space = exporting is the goal. */
  isClubSpace: boolean;
  /** Whether any playlist has ever been shared (dashboard rows exist). */
  hasSharedAny: boolean;
  /**
   * Newest shared playlist someone hasn't finished (latestBehindPlaylist in
   * shared-by-me.ts), or null when everyone is caught up. The remind hero is
   * scoped to ONE playlist on purpose — nudging stragglers of a weeks-old
   * playlist is never the coach's next action.
   */
  latestBehind: { playlistId: string; playlistName: string; behindCount: number } | null;
  /** Personal spaces: has the user ever exported an MP4. */
  hasExported: boolean;
}

export type HomeHero =
  | { kind: "import-first"; demoMatchId: string | null }
  | { kind: "build-playlist" }
  | { kind: "add-clips"; playlist: HomeHeroPlaylist }
  | { kind: "share"; playlist: HomeHeroPlaylist }
  | { kind: "export"; playlist: HomeHeroPlaylist }
  | { kind: "remind"; playlistId: string; playlistName: string; behindCount: number }
  | { kind: "caught-up" };

/** Newest playlist that actually has clips (input order is newest-first). */
function newestWithClips(playlists: HomeHeroPlaylist[]): HomeHeroPlaylist | null {
  return playlists.find((p) => p.clipCount > 0) ?? null;
}

export function computeHomeHero(input: HomeHeroInput): HomeHero {
  if (input.ownGameCount === 0) {
    return { kind: "import-first", demoMatchId: input.demoMatchId };
  }
  if (input.playlists.length === 0) {
    return { kind: "build-playlist" };
  }
  const withClips = newestWithClips(input.playlists);
  if (!withClips) {
    return { kind: "add-clips", playlist: input.playlists[0] };
  }
  if (input.isClubSpace) {
    if (!input.hasSharedAny) return { kind: "share", playlist: withClips };
    if (input.latestBehind) return { kind: "remind", ...input.latestBehind };
    return { kind: "caught-up" };
  }
  if (!input.hasExported) {
    return { kind: "export", playlist: withClips };
  }
  return { kind: "caught-up" };
}
