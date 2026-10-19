// Scoutable — cloud game videos Edge Function: superseded clip files.
// A shipped clip is a file in the PUBLIC media bucket under the desktop's key
// scheme (clipShipKey). When the file a playlist clip points at changes (a
// re-cut by render_done, a trim or a sync change clearing it, the desktop
// re-shipping it), a trigger on playlist_clips queues the old key in
// `media_deletions` (migration 20261022100000). This drains the queue:
//
//   media_purge   (x-purge-secret: pg_cron nightly through run_game_video_purge,
//                 the smoke script) deletes a queued key only when no playlist
//                 clip and no live ship job references it any more: two
//                 playlists with the same clip and clip length share one file.
//                 A key still in use is dropped from the queue and kept; it is
//                 queued again when that clip changes too.
//
// Staging and prod share the media bucket, and staging holds copies of
// prod's rows, so a project only deletes in its MEDIA_PURGE_SCOPE: `all` on
// the project that owns the bucket (prod, set at rollout), the smoke's
// throwaway games otherwise (the default). Keys outside the scope stay queued.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  CLIP_SHIP_KEY_RE,
  mediaPurgePrefix,
  type GameVideoMediaPurgeResponse,
} from "../../../packages/shared/lib/game-video-wire.ts";
import { ForeignKeyError, MEDIA_PURGE_SCOPE, err, mediaConfigured, mediaDeleteClip, ok } from "./common.ts";

/** Keys looked at per run; the next night carries on. */
const MEDIA_PURGE_BATCH = 100;

async function dropQueued(admin: SupabaseClient, key: string): Promise<boolean> {
  const { error } = await admin.from("media_deletions").delete().eq("storage_key", key);
  return !error;
}

export async function purgeMedia(admin: SupabaseClient): Promise<Response> {
  if (!mediaConfigured()) return err(503, "renderer_unavailable");
  const scope = MEDIA_PURGE_SCOPE;
  const prefix = mediaPurgePrefix(scope);
  const { data, error } = await admin.rpc("_media_deletions_due", { p_limit: MEDIA_PURGE_BATCH, p_key_prefix: prefix });
  if (error) {
    console.error("[game-video] reading the media deletion queue failed:", error.message);
    return err(500, "lookup_failed");
  }
  const due = ((data ?? []) as { storage_key: string }[]).map((r) => r.storage_key);

  const result: GameVideoMediaPurgeResponse = { scope, deleted: 0, kept: 0, refused: 0, failed: 0, remaining: 0, outOfScope: 0 };
  for (const key of due) {
    if (!CLIP_SHIP_KEY_RE.test(key) || !key.startsWith(prefix)) {
      console.error("[game-video] media purge refused a key outside the clip scheme:", key);
      result.refused++;
      continue;
    }
    // Checked right before the delete, one key at a time, so a clip that came
    // back to a file (a trim undone, the same sync again) keeps it.
    const { data: inUse, error: refError } = await admin.rpc("_media_key_referenced", { p_key: key });
    if (refError) {
      console.error("[game-video] checking a queued clip file failed:", refError.message);
      result.failed++;
      continue;
    }
    if (inUse === true) {
      if (await dropQueued(admin, key)) result.kept++;
      else result.failed++;
      continue;
    }
    let gone = false;
    try {
      gone = await mediaDeleteClip(key);
    } catch (e) {
      if (e instanceof ForeignKeyError) {
        result.refused++;
        continue;
      }
      console.error("[game-video] deleting a clip file failed:", e instanceof Error ? e.message : String(e));
    }
    if (!gone) {
      result.failed++; // stays queued for tomorrow
      continue;
    }
    if (await dropQueued(admin, key)) result.deleted++;
    else result.failed++;
  }

  const [{ count: inScope }, { count: total }] = await Promise.all([
    admin.from("media_deletions").select("storage_key", { count: "exact", head: true }).like("storage_key", `${prefix}%`),
    admin.from("media_deletions").select("storage_key", { count: "exact", head: true }),
  ]);
  result.remaining = inScope ?? 0;
  result.outOfScope = Math.max(0, (total ?? 0) - (inScope ?? 0));
  return ok(result);
}
