/**
 * The league catalogue for the importer: the Genius leagues served by the
 * `genius` edge function plus the Profixio district leagues served by the
 * `profixio` one, merged into one list the picker renders with no idea which
 * provider is behind an entry.
 *
 * Why served rather than bundled: each function derives what it will fetch
 * from the same structure it serves, so a season the picker offers is always
 * one the function will fetch. Adding a season is a function deploy rather
 * than a desktop release.
 *
 * The two fetches are independent — a failed or slow Profixio crawl keeps the
 * Genius list intact and vice versa — and they cache under separate keys. The
 * Genius key and payload are byte-identical to what released builds write,
 * because every build of the app shares this WebView origin's localStorage.
 * Renders immediately from cache or the bundled Genius copy, then revalidates.
 */
import { useEffect, useMemo, useState } from "react";
import { getGeniusLeagues } from "@scoutable/shared/lib/genius-client";
import { getProfixioLeagues } from "@scoutable/shared/lib/profixio-client";
import { catalogToLeagues, parseLeagueCatalog } from "@scoutable/shared/lib/league-catalog";
import type { League } from "@scoutable/shared/types/league";
import { BUNDLED_LEAGUES } from "@/lib/basketball-api";
import { createClient } from "@/lib/supabase/client";
import { Sentry } from "@/lib/sentry";

const GENIUS_CACHE_KEY = "scoutable_league_catalog";
const PROFIXIO_CACHE_KEY = "scoutable_league_catalog_profixio";

/** Last good catalogue under a key, so the picker paints without waiting on the network. */
function readCache(key: string): League[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const catalog = parseLeagueCatalog(JSON.parse(raw)?.leagues);
    return catalog ? catalogToLeagues(catalog) : null;
  } catch {
    // Unparseable or unreadable — treated the same as absent.
    return null;
  }
}

function writeCache(key: string, leagues: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), leagues }));
  } catch {
    // Caching is an optimisation; a full or blocked store must not break the page.
  }
}

export function useLeagues(): League[] {
  const [genius, setGenius] = useState<League[]>(() => readCache(GENIUS_CACHE_KEY) ?? BUNDLED_LEAGUES);
  const [profixio, setProfixio] = useState<League[]>(() => readCache(PROFIXIO_CACHE_KEY) ?? []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    getGeniusLeagues(supabase)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Includes `unknown_action` from a function that predates this
          // release, which is exactly why the bundled copy stays.
          throw new Error(`leagues fetch failed: ${res.error}`);
        }
        const catalog = parseLeagueCatalog(res.data.leagues);
        if (!catalog) throw new Error("leagues payload failed validation");
        setGenius(catalogToLeagues(catalog));
        writeCache(GENIUS_CACHE_KEY, res.data.leagues);
      })
      .catch((err) => {
        // Silent for the user — they keep a working picker — but we need to
        // know, or a catalogue that never refreshes looks like nothing at all.
        console.error("[leagues:genius]", err);
        Sentry.captureException(err);
      });

    getProfixioLeagues(supabase)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`profixio leagues fetch failed: ${res.error}`);
        const raw = res.data.leagues;
        // An empty district crawl is a legitimate "nothing discovered yet",
        // unlike the Genius list where empty is never a real answer.
        if (Array.isArray(raw) && raw.length === 0) {
          setProfixio([]);
          return;
        }
        const catalog = parseLeagueCatalog(raw);
        if (!catalog) throw new Error("profixio leagues payload failed validation");
        setProfixio(catalogToLeagues(catalog));
        writeCache(PROFIXIO_CACHE_KEY, raw);
      })
      .catch((err) => {
        console.error("[leagues:profixio]", err);
        Sentry.captureException(err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Stable identity matters: upload-zone's selection effect keys on this list.
  return useMemo(() => [...genius, ...profixio], [genius, profixio]);
}
