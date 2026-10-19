"use client";

import { toast } from "sonner";
import { shipPlaylist } from "@scoutable/shared/lib/game-video-client";
import { noCopyClips, unshippedClips } from "@scoutable/shared/lib/playlist-edits";
import { isClipItem, type Playlist, type StoredMatch } from "@scoutable/shared/types/match";
import type { ShareReadiness } from "@/components/playlist/share-dialog";
import { createClient } from "@/lib/supabase/client";

/**
 * What the share dialog says about a playlist's clips before they are
 * shared: the ones the server can cut from the owner's cloud copies, the
 * ones it can't (their game has no copy and the desktop never uploaded
 * them), and whether the sample game is in it.
 */
export function shareReadiness(
  playlist: Playlist,
  readyMatchIds: ReadonlySet<string>,
  matches: ReadonlyMap<string, Pick<StoredMatch, "isDemo">>,
): ShareReadiness {
  return {
    prepare: unshippedClips(playlist).filter((c) => readyMatchIds.has(c.matchId)).length,
    // A clip the desktop already uploaded is watchable whatever its game has here.
    noCopy: noCopyClips(playlist, readyMatchIds).filter((c) => !c.r2Url).length,
    demo: playlist.items.some((i) => isClipItem(i) && !!matches.get(i.matchId)?.isDemo),
  };
}

/**
 * Asks the server to cut the playlist's clips from the cloud copies after a
 * share, so recipients can watch (the editor does the same through its own
 * ship hook). Quiet about failure: the share itself has landed, and a
 * project without a converter answers `renderer_unavailable`.
 */
export function requestShipAfterShare(playlistId: string) {
  void shipPlaylist(createClient(), playlistId).then((result) => {
    if (!result.ok || result.data.total === 0) return;
    const n = result.data.total;
    toast.success(n === 1 ? "Preparing 1 clip" : `Preparing ${n} clips`, { description: "Recipients see them as they are ready." });
  });
}

/** What came of asking the server to prepare several playlists' clips at once. */
export interface PrepareOutcome {
  /** Clips the server is cutting now. */
  preparing: number;
  /** Clips whose game has no cloud copy, so nothing can be cut. */
  noCopy: number;
  /** The project has no converter configured. */
  unavailable: boolean;
}

/**
 * Asks the server to prepare the clips of every playlist given (the shared
 * dashboard's "Prepare clips"): one request per playlist, the totals summed.
 */
export async function requestShipForMany(playlistIds: readonly string[]): Promise<PrepareOutcome> {
  const supabase = createClient();
  const outcome: PrepareOutcome = { preparing: 0, noCopy: 0, unavailable: false };
  for (const id of playlistIds) {
    const result = await shipPlaylist(supabase, id);
    if (!result.ok) {
      if (result.error === "renderer_unavailable") outcome.unavailable = true;
      continue;
    }
    outcome.preparing += result.data.total;
    outcome.noCopy += result.data.noCopy.reduce((n, g) => n + g.eventIds.length, 0);
  }
  return outcome;
}
