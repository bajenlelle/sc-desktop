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
export function refreshGeniusCatalog(supabase: SupabaseClient, storage: StorageLike | null | undefined): Promise<League[]> {
  return revalidateOnce(GENIUS_CACHE_KEY, () => fetchGeniusCatalog(supabase, storage));
}

async function fetchGeniusCatalog(supabase: SupabaseClient, storage: StorageLike | null | undefined): Promise<League[]> {
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
export function refreshProfixioCatalog(supabase: SupabaseClient, storage: StorageLike | null | undefined): Promise<League[]> {
  return revalidateOnce(PROFIXIO_CACHE_KEY, () => fetchProfixioCatalog(supabase, storage));
}

async function fetchProfixioCatalog(supabase: SupabaseClient, storage: StorageLike | null | undefined): Promise<League[]> {
  const res = await getProfixioLeagues(supabase);
  if (!res.ok) throw new Error(`profixio leagues fetch failed: ${res.error}`);
  const raw = res.data.leagues;
  if (Array.isArray(raw) && raw.length === 0) return [];
  const catalog = parseLeagueCatalog(raw);
  if (!catalog) throw new Error("profixio leagues payload failed validation");
  writeLeagueCache(storage, PROFIXIO_CACHE_KEY, raw);
  return catalogToLeagues(catalog);
}

/**
 * A catalogue changes a few times a season, but every page that shows a
 * league picker or a stats card (the editors, the importers) mounts the
 * hook and revalidated both catalogues against their edge functions on
 * every visit. One revalidation per catalogue per ten minutes now serves
 * every caller in that window, concurrent ones included; a failure is
 * forgotten at once, so the next caller tries again.
 */
const REVALIDATE_EVERY_MS = 10 * 60_000;
const revalidations = new Map<string, { at: number; promise: Promise<League[]> }>();
const latest = new Map<string, League[]>();

/**
 * The last catalogue revalidated in this session, if any. A hook that starts
 * from it gets the same array back from refresh*Catalog in the window, so
 * React skips the re-render.
 */
export function latestCatalog(key: string): League[] | null {
  return latest.get(key) ?? null;
}

function revalidateOnce(key: string, run: () => Promise<League[]>, now: number = Date.now()): Promise<League[]> {
  const recent = revalidations.get(key);
  if (recent && now - recent.at < REVALIDATE_EVERY_MS) return recent.promise;
  const promise = run();
  revalidations.set(key, { at: now, promise });
  promise.then((leagues) => latest.set(key, leagues)).catch(() => {
    if (revalidations.get(key)?.promise === promise) revalidations.delete(key);
  });
  return promise;
}

/** Tests only: forget the session's revalidations. */
export function resetLeagueCatalogRevalidations(): void {
  revalidations.clear();
  latest.clear();
}
