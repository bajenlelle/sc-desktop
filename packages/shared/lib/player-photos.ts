/**
 * Player photos: Genius roster headshots copied into the media bucket by the
 * `genius` edge function's roster sync (`league_players.photo_key`, migration
 * 20261119100000). A key names the 200 px (S1) file; the other sizes swap the
 * suffix: players/genius/<personId>/<hash>-{T1,S1,M1,L1}.jpg = 75/200/400/600 px.
 *
 * Report players are keyed by the Genius personId (report drafts and play-by-play
 * carry the same id), so one query gives a report's photos. Isomorphic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";

export type PlayerPhotoSize = "T1" | "S1" | "M1" | "L1";

/**
 * The media bucket's public host. Player photos live in the one bucket prod and
 * staging share, so the desktop needs no per-environment setting; the web page
 * passes its NEXT_PUBLIC_R2_PUBLIC_URL instead.
 */
export const MEDIA_BASE = "https://media.scoutable.se";

const KEY_RE = /^players\/[a-z]+\/\d+\/[0-9a-f]{16,64}-S1\.jpg$/;

/** A key the roster sync could have written (guards what goes into a published report). */
export function isPlayerPhotoKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

/** Public URL of one size of a photo, or null without a media base or a valid key. */
export function playerPhotoUrl(base: string | null | undefined, key: string | null | undefined, size: PlayerPhotoSize = "S1"): string | null {
  if (!base || !isPlayerPhotoKey(key)) return null;
  return `${base.replace(/\/+$/, "")}/${key.replace(/-S1\.jpg$/, `-${size}.jpg`)}`;
}

/** `src` + `srcSet` for an <img> drawn at ~`px` CSS pixels: the smallest size that is sharp at 1x, the next at 2x. */
export function playerPhotoSources(base: string | null | undefined, key: string | null | undefined, px: number): { src: string; srcSet: string } | null {
  const order: [PlayerPhotoSize, number][] = [["T1", 75], ["S1", 200], ["M1", 400], ["L1", 600]];
  const at = (need: number) => (order.find(([, w]) => w >= need) ?? order[order.length - 1])[0];
  const one = playerPhotoUrl(base, key, at(px));
  const two = playerPhotoUrl(base, key, at(px * 2));
  if (!one || !two) return null;
  return { src: one, srcSet: `${one} 1x, ${two} 2x` };
}

const LOOKUP_CHUNK = 200;

/**
 * Photo keys by player id for the ids that have one. Ids that aren't numeric
 * (no Genius person) are skipped. A failed read reports and returns what it has:
 * a missing photo only falls back to the jersey number.
 */
export async function fetchPlayerPhotos(supabase: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
  for (let i = 0; i < wanted.length; i += LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from("league_players")
      .select("source_person_id, photo_key")
      .eq("source", "genius")
      .not("photo_key", "is", null)
      .in("source_person_id", wanted.slice(i, i + LOOKUP_CHUNK));
    if (error) {
      reportDbError("fetchPlayerPhotos", error);
      return out;
    }
    for (const row of (data ?? []) as { source_person_id: string; photo_key: string | null }[]) {
      if (isPlayerPhotoKey(row.photo_key)) out.set(row.source_person_id, row.photo_key);
    }
  }
  return out;
}
