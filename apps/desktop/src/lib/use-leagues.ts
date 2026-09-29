/**
 * The league catalogue for the importer, served by the `genius` edge function.
 *
 * Why not just bundle it: the function derives its fetch allowlist from the
 * same structure it serves here, so a season the picker offers is always one
 * the function will fetch. Adding next season becomes a function deploy rather
 * than a desktop release — and there is no window where the two disagree,
 * which is what produced "Failed to load schedule" when they last did.
 *
 * Renders immediately from cache or the bundled copy, then revalidates. A
 * failed fetch keeps whatever we already had: an empty picker would be worse
 * than a stale one.
 */
import { useEffect, useState } from "react";
import { getGeniusLeagues } from "@scoutable/shared/lib/genius-client";
import { catalogToLeagues, parseLeagueCatalog } from "@scoutable/shared/lib/league-catalog";
import type { League } from "@scoutable/shared/types/league";
import { BUNDLED_LEAGUES } from "@/lib/basketball-api";
import { createClient } from "@/lib/supabase/client";
import { Sentry } from "@/lib/sentry";

const CACHE_KEY = "scoutable_league_catalog";

/** Last good catalogue, so the picker paints without waiting on the network. */
function readCache(): League[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const catalog = parseLeagueCatalog(JSON.parse(raw)?.leagues);
    return catalog ? catalogToLeagues(catalog) : null;
  } catch {
    // Unparseable or unreadable — treated the same as absent.
    return null;
  }
}

function writeCache(leagues: unknown): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), leagues }));
  } catch {
    // Caching is an optimisation; a full or blocked store must not break the page.
  }
}

export function useLeagues(): League[] {
  const [leagues, setLeagues] = useState<League[]>(() => readCache() ?? BUNDLED_LEAGUES);

  useEffect(() => {
    let cancelled = false;
    getGeniusLeagues(createClient())
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Includes `unknown_action` from a function that predates this
          // release, which is exactly why the bundled copy stays.
          throw new Error(`leagues fetch failed: ${res.error}`);
        }
        const catalog = parseLeagueCatalog(res.data.leagues);
        if (!catalog) throw new Error("leagues payload failed validation");
        setLeagues(catalogToLeagues(catalog));
        writeCache(res.data.leagues);
      })
      .catch((err) => {
        // Silent for the user — they keep a working picker — but we need to
        // know, or a catalogue that never refreshes looks like nothing at all.
        console.error("[leagues]", err);
        Sentry.captureException(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return leagues;
}
