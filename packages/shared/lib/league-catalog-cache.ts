/**
 * The league catalogue for the importer: the Genius leagues served by the
 * `genius` edge function plus the Profixio district leagues served by the
 * `profixio` one, merged into one list the picker renders with no idea which
 * provider is behind an entry.
 *
 * Why served rather than bundled: each function derives what it will fetch
 * from the same structure it serves, so a season the picker offers is always
 * one the function will fetch. Adding a season is a function deploy rather
 * than an app release.
 *
 * The two fetches are independent (a failed or slow Profixio fetch keeps the
 * Genius list intact and vice versa) and they cache under separate keys in
 * whatever Storage the app hands in: the desktop webview's and the web app's
 * localStorage. The Genius key and payload are byte-identical to what
 * released desktop builds write, because every build of the app shares this
 * WebView origin's localStorage. Each app's `useLeagues` hook renders at once
 * from the cache or the bundled Genius copy, then revalidates through the
 * refresh functions here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGeniusLeagues } from "./genius-client";
import { getProfixioLeagues } from "./profixio-client";
import { catalogToLeagues, parseLeagueCatalog } from "./league-catalog";
import type { League } from "../types/league";

export const GENIUS_CACHE_KEY = "scoutable_league_catalog";
// _v2: the API's catalogue (the tournaments Profixio granted); v1 held the
// scraped one, every district and two seasons.
export const PROFIXIO_CACHE_KEY = "scoutable_league_catalog_profixio_v2";

/** The part of Storage the cache uses, so a test or a platform can hand in its own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Last good catalogue under a key, so the picker paints without waiting on the network. */
export function readLeagueCache(storage: StorageLike | null | undefined, key: string): League[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const catalog = parseLeagueCatalog(JSON.parse(raw)?.leagues);
    return catalog ? catalogToLeagues(catalog) : null;
  } catch {
    // Unparseable or unreadable: treated the same as absent.
    return null;
  }
}

export function writeLeagueCache(storage: StorageLike | null | undefined, key: string, leagues: unknown, now: number = Date.now()): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ fetchedAt: now, leagues }));
  } catch {
    // Caching is an optimisation; a full or blocked store must not break the page.
  }
}

/**
 * The served Genius catalogue, validated and cached. Throws when the function
 * fails or the payload doesn't validate (including `unknown_action` from a
 * function that predates the catalogue, which is exactly why callers keep
 * the bundled copy).
 */
export async function refreshGeniusCatalog(supabase: SupabaseClient, storage: StorageLike | null | undefined): Promise<League[]> {
  const res = await getGeniusLeagues(supabase);
  if (!res.ok) throw new Error(`leagues fetch failed: ${res.error}`);
  const catalog = parseLeagueCatalog(res.data.leagues);
  if (!catalog) throw new Error("leagues payload failed validation");
  writeLeagueCache(storage, GENIUS_CACHE_KEY, res.data.leagues);
  return catalogToLeagues(catalog);
}

/**
 * The served Profixio catalogue, validated and cached. An empty list is a
 * legitimate "nothing granted yet", unlike the Genius list where empty is
 * never a real answer.
 */
export async function refreshProfixioCatalog(supabase: SupabaseClient, storage: StorageLike | null | undefined): Promise<League[]> {
  const res = await getProfixioLeagues(supabase);
  if (!res.ok) throw new Error(`profixio leagues fetch failed: ${res.error}`);
  const raw = res.data.leagues;
  if (Array.isArray(raw) && raw.length === 0) return [];
  const catalog = parseLeagueCatalog(raw);
  if (!catalog) throw new Error("profixio leagues payload failed validation");
  writeLeagueCache(storage, PROFIXIO_CACHE_KEY, raw);
  return catalogToLeagues(catalog);
}
