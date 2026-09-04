/**
 * Highlight shares — rendered highlight MP4s hosted behind an unguessable
 * share id for the "send to phone" flow. Isomorphic: callers pass their
 * platform Supabase client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface HighlightShare {
  id: string;
  title: string;
  r2Url: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * R2 keys for a share's artifacts. The .jpg poster sits beside the .mp4
 * under highlights/{userId}/ so the Cloudflare lifecycle rule and the
 * GDPR delete-account prefix sweep cover both without changes.
 */
export function highlightShareKeys(
  userId: string,
  shareId: string
): { video: string; poster: string } {
  return {
    video: `highlights/${userId}/${shareId}.mp4`,
    poster: `highlights/${userId}/${shareId}.jpg`,
  };
}

export type HighlightAspect = "16:9" | "9:16";

/** Structural subset of the desktop's ExportSegment that shapes the render. */
export type HighlightContentSegment =
  | {
      kind: "clip";
      matchId: string;
      event: { eventId: number };
      preRollOffset?: number;
      postRollOffset?: number;
      cropKeyframes?: { t: number; cx: number }[];
    }
  | { kind: "text"; text: string; durationSeconds: number };

/** cyrb53 — small, fast, deterministic 53-bit string hash (public domain). */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Fingerprint of exactly what a send-to-phone render contains: clip
 * identities IN ORDER, roll settings, text cards — and, for 9:16 only, the
 * crop-pan keyframes (pans don't shape a widescreen render, so a pan edit
 * must not invalidate a 16:9 link). Reuse requires an identical key, so any
 * relevant edit between sends re-renders instead of serving a stale link.
 * Watermark is deliberately outside the key — this surface is always
 * watermarked.
 */
export function highlightContentKey(
  segments: HighlightContentSegment[],
  preRoll: number,
  postRoll: number,
  aspect: HighlightAspect
): string {
  const parts = segments.map((s) =>
    s.kind === "text"
      ? `t|${s.durationSeconds}|${s.text}`
      : `c|${s.matchId}|${s.event.eventId}|${s.preRollOffset ?? 0}|${s.postRollOffset ?? 0}|${
          aspect === "9:16"
            ? (s.cropKeyframes ?? [])
                .map((k) => `${k.t.toFixed(3)}:${k.cx.toFixed(4)}`)
                .join(",")
            : ""
        }`
  );
  return cyrb53(`v1|${preRoll}|${postRoll}|${parts.join(";")}`);
}

/**
 * Insert a share row. The caller supplies the id so the R2 key
 * (highlights/{userId}/{id}.mp4) and the row can agree before upload.
 */
export async function createHighlightShare(
  supabase: SupabaseClient,
  share: {
    id: string;
    playlistId?: string;
    title: string;
    r2Url: string;
    r2Key: string;
    clipCount: number;
    posterUrl?: string;
    posterKey?: string;
    aspect: HighlightAspect;
    contentKey: string;
  }
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("highlight_shares").insert({
    id: share.id,
    user_id: user.id,
    playlist_id: share.playlistId ?? null,
    title: share.title,
    r2_url: share.r2Url,
    r2_key: share.r2Key,
    clip_count: share.clipCount,
    poster_url: share.posterUrl ?? null,
    poster_key: share.posterKey ?? null,
    aspect: share.aspect,
    content_key: share.contentKey,
  });
  if (error) throw new Error(`Failed to create highlight share: ${error.message}`);
}

/**
 * Newest non-expired share the caller created for a playlist with the SAME
 * aspect and content fingerprint — reuse is only ever an exact match, so a
 * changed playlist (or an edited crop pan) re-renders automatically. Legacy
 * rows have content_key NULL and never match.
 */
export async function getMyShareForPlaylist(
  supabase: SupabaseClient,
  playlistId: string,
  aspect: HighlightAspect,
  contentKey: string
): Promise<{ id: string; createdAt: string } | null> {
  const { data, error } = await supabase
    .from("highlight_shares")
    .select("id, created_at")
    .eq("playlist_id", playlistId)
    .eq("aspect", aspect)
    .eq("content_key", contentKey)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string, createdAt: data.created_at as string };
}

/** Anonymous-safe lookup used by the public /h/{id} page. */
export async function getHighlightShare(
  supabase: SupabaseClient,
  id: string
): Promise<
  | { valid: true; title: string; url: string; posterUrl: string | null; createdAt: string }
  | { valid: false; reason: "not_found" | "expired" }
> {
  const { data, error } = await supabase.rpc("get_highlight_share", { p_id: id });
  if (error) throw new Error(`Failed to load highlight: ${error.message}`);
  const r = data as {
    valid: boolean;
    reason?: string;
    title?: string;
    url?: string;
    poster_url?: string | null;
    created_at?: string;
  };
  if (!r.valid) return { valid: false, reason: (r.reason as "not_found" | "expired") ?? "not_found" };
  return { valid: true, title: r.title!, url: r.url!, posterUrl: r.poster_url ?? null, createdAt: r.created_at! };
}
