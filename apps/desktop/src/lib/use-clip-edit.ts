import { useCallback, useEffect, useRef } from "react";
import { Sentry } from "@/lib/sentry";
import { toast } from "sonner";
import type { ClipDrawing } from "@scoutable/shared/lib/clip-drawing";
import type { SlowSection } from "@scoutable/shared/lib/clip-timeline";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import type { PlaylistClipItem } from "@/types/match";
import { changeClipLength, updateClip } from "@/lib/playlists-db";
import { enqueuePlaylistWrite } from "@/lib/playlist-write-queue";

/** What one clip's edit may change: its note, its drawings and its slow motion (its length goes through saveLength). */
export interface ClipEditPatch {
  note?: string | null;
  drawings?: ClipDrawing[] | null;
  slowMotion?: SlowSection[] | null;
}

/** How long typing or a burst of stepper clicks waits before it is saved. */
const SAVE_AFTER_MS = 600;

/**
 * Saves the changes made to clips of one playlist outside the playlist editor
 * (the report's Edit clip sheet): each change shows at once through `onPatch`
 * and is written shortly after, a burst of changes to one clip as one write,
 * in turn with the playlist's other writes (lib/playlist-write-queue.ts). A
 * change still waiting is written when the caller flushes and when it goes.
 * A failed write says so; what it showed stays, as in the editor.
 */
export function useClipEdit(playlistId: string, onPatch: (key: string, patch: Partial<PlaylistClipItem>) => void) {
  const pending = useRef(new Map<string, { matchId: string; eventId: number; patch: ClipEditPatch }>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(playlistId);
  idRef.current = playlistId;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const writes = [...pending.current.values()];
    pending.current.clear();
    const id = idRef.current;
    for (const w of writes) {
      void enqueuePlaylistWrite(id, () =>
        updateClip(id, w.matchId, w.eventId, w.patch).catch((e) => {
          Sentry.captureException(e);
          toast.error("Couldn’t save the clip’s changes");
        }),
      );
    }
  }, []);

  /** A note, drawings or slow motion on a clip: shown now, saved shortly after (or at once with `now`). */
  const change = useCallback(
    (clip: Pick<PlaylistClipItem, "matchId" | "eventId">, patch: ClipEditPatch, now = false) => {
      const key = `${clip.matchId}:${clip.eventId}`;
      onPatch(key, {
        ...("note" in patch ? { note: patch.note || undefined } : {}),
        ...("drawings" in patch ? { drawings: patch.drawings?.length ? patch.drawings : undefined } : {}),
        ...("slowMotion" in patch ? { slowMotion: patch.slowMotion?.length ? patch.slowMotion : undefined } : {}),
      });
      const was = pending.current.get(key);
      pending.current.set(key, { matchId: clip.matchId, eventId: clip.eventId, patch: { ...was?.patch, ...patch } });
      if (timer.current) clearTimeout(timer.current);
      if (now) flush();
      else timer.current = setTimeout(flush, SAVE_AFTER_MS);
    },
    [onPatch, flush],
  );

  /**
   * A clip's new length (a trim, or Reset trim): shown at once and saved, put back with a word if
   * the save fails. An uploaded copy was cut at the old length: it is retired, and the next share
   * uploads the new cut. True once the length is saved.
   */
  const saveLength = useCallback(
    async (clip: PlaylistClipItem, pre: number, post: number): Promise<boolean> => {
      const key = itemKey(clip);
      onPatch(key, { preRollOffset: pre, postRollOffset: post, r2Url: undefined });
      const id = idRef.current;
      let ok = true;
      await enqueuePlaylistWrite(id, async () => {
        try {
          const r = await changeClipLength(id, clip, pre, post);
          // The old upload couldn't be retired: it is still the clip's copy until the next share.
          if (r.shippedCut === "kept") onPatch(key, { r2Url: clip.r2Url });
        } catch (e) {
          ok = false;
          Sentry.captureException(e);
        }
      });
      if (!ok) {
        onPatch(key, { preRollOffset: clip.preRollOffset, postRollOffset: clip.postRollOffset, r2Url: clip.r2Url });
        toast.error("Couldn’t save the clip’s length");
      }
      return ok;
    },
    [onPatch],
  );

  // Leaving with a change still waiting saves it.
  useEffect(() => () => flush(), [flush]);

  return { change, saveLength, flush };
}
