/**
 * BasketTV (Solidsport white-label) HTTP client for the nightly tip-off job.
 * Public: past games per channel and the watch metadata of a game. With a
 * subscriber session (login): the signed MP4 download URL of a replay.
 *
 * This runs in a public repo's Actions log, so nothing here ever prints a
 * token or a URL: errors carry the path and the HTTP status only, and secrets
 * pass through `mask` before use.
 */
import type { BaskettvPastGame } from "@scoutable/shared/lib/baskettv";

const API = "https://solidsport.com/api/play_v1/";

export class BaskettvError extends Error {
  constructor(
    path: string,
    public readonly status: number,
  ) {
    super(`baskettv ${path.split("?")[0]} -> HTTP ${status}`);
  }
}

async function call<T>(path: string, o: { method?: string; params?: Record<string, string | number | boolean>; json?: unknown; token?: string } = {}): Promise<T> {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(o.params ?? {})) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (o.json !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8";
  if (o.token) headers.Authorization = o.token;
  const res = await fetch(url, { method: o.method ?? "GET", headers, body: o.json === undefined ? undefined : JSON.stringify(o.json) });
  if (!res.ok) throw new BaskettvError(path, res.status);
  return (await res.json()) as T;
}

export interface WatchInfo {
  id: string;
  duration: number | null;
  live_start_at: number | null;
  allow_download: boolean;
  access_restriction: string | null;
}

/** Newest-first past games of a channel, paging until games older than `olderThanTs` appear. */
export async function pastGames(channel: string, olderThanTs: number, maxPages = 10): Promise<BaskettvPastGame[]> {
  const out: BaskettvPastGame[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await call<BaskettvPastGame[]>("timeline_objects/collections/past_games", {
      params: { company: channel, per_page: 100, page, include_games_without_livestreams: true },
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (Math.min(...batch.map((g) => g.start_at ?? 0)) < olderThanTs) break;
  }
  return out;
}

/** The media object behind a game on a channel (public; paywall details included). */
export function watch(channel: string, gameSlug: string): Promise<WatchInfo> {
  return call<WatchInfo>("media_object/watch", { params: { game_ident: gameSlug, company: channel } });
}

/** Subscriber session token; the site's client sends it as the raw `Authorization` header. */
export async function login(username: string, password: string): Promise<string> {
  const r = await call<{ token?: string }>("session/auth", { method: "POST", json: { username, password } });
  if (!r?.token) throw new Error("baskettv login: no token in the response");
  return r.token;
}

/** Signed MP4 download URL for a media object; needs a session with access to the channel. */
export async function downloadUrl(channel: string, mediaId: string, token: string): Promise<string> {
  const r = await call<{ download_url?: string }>(`companies/${channel}/download/video`, { params: { media_object: mediaId }, token });
  if (!r?.download_url) throw new Error("baskettv download: no download_url in the response");
  return r.download_url;
}
