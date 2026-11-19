import { useMemo, useSyncExternalStore } from "react";
import { createShipScheduler, type ShipStatus } from "@scoutable/shared/lib/ship-scheduler";
import type { ClipShipResult } from "@scoutable/shared/lib/ship-result";

/**
 * The app's one ship scheduler: the game view sends a shared playlist's new
 * clips through it after a quiet spell, on a change of playlist and on
 * leaving the game, and the editor waits while it runs for a playlist
 * (`packages/shared/lib/ship-scheduler.ts`). Module-level, so a send started
 * as the coach leaves the game goes on wherever they go.
 */
export const shipScheduler = createShipScheduler();

/** Bumped on every change, so hooks read one number instead of a fresh map. */
let version = 0;
shipScheduler.subscribe(() => {
  version++;
});
const subscribe = (listener: () => void) => shipScheduler.subscribe(listener);
const getVersion = () => version;

export function useShipStatus(playlistId: string | null): ShipStatus | null {
  return useSyncExternalStore(subscribe, () => (playlistId ? shipScheduler.status(playlistId) : null));
}

/** The statuses of these playlists that have one. */
export function useShipStatuses(ids: readonly string[]): ReadonlyMap<string, ShipStatus> {
  const v = useSyncExternalStore(subscribe, getVersion);
  const key = ids.join("|");
  return useMemo(() => {
    const out = new Map<string, ShipStatus>();
    for (const id of key ? key.split("|") : []) {
      const s = shipScheduler.status(id);
      if (s) out.set(id, s);
    }
    return out;
    // `v` is the scheduler's change count: a new one means new statuses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, key]);
}

type Uploaded = ClipShipResult["uploaded"];
const uploadListeners = new Set<(playlistId: string, uploaded: Uploaded) => void>();

/** Files a send put up, for every copy of the playlist on screen (the editor's too). */
export function emitUploaded(playlistId: string, uploaded: Uploaded): void {
  if (uploaded.length === 0) return;
  for (const l of [...uploadListeners]) l(playlistId, uploaded);
}

export function onUploaded(listener: (playlistId: string, uploaded: Uploaded) => void): () => void {
  uploadListeners.add(listener);
  return () => {
    uploadListeners.delete(listener);
  };
}
