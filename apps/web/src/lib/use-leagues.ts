"use client";

/**
 * The league catalogue for the web importer: the Genius leagues plus the
 * Profixio district leagues, merged into one list. Renders immediately from
 * this browser's localStorage cache or the bundled Genius copy, then
 * revalidates against both edge functions. The cache keys, validation and
 * fetches live in @scoutable/shared/lib/league-catalog-cache (the desktop's
 * hook is the same shape).
 */
import { useEffect, useMemo, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import {
  GENIUS_CACHE_KEY,
  PROFIXIO_CACHE_KEY,
  latestCatalog,
  readLeagueCache,
  refreshGeniusCatalog,
  refreshProfixioCatalog,
} from "@scoutable/shared/lib/league-catalog-cache";
import { keepIfSame } from "@scoutable/shared/lib/keep-if-same";
import { BUNDLED_LEAGUES } from "@scoutable/shared/lib/league-schedule";
import type { League } from "@scoutable/shared/types/league";
import { createClient } from "@/lib/supabase/client";

const storage = () => (typeof window === "undefined" ? null : window.localStorage);

export function useLeagues(): League[] {
  const [genius, setGenius] = useState<League[]>(() => latestCatalog(GENIUS_CACHE_KEY) ?? readLeagueCache(storage(), GENIUS_CACHE_KEY) ?? BUNDLED_LEAGUES);
  const [profixio, setProfixio] = useState<League[]>(() => latestCatalog(PROFIXIO_CACHE_KEY) ?? readLeagueCache(storage(), PROFIXIO_CACHE_KEY) ?? []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // Silent for the user (they keep a working picker) but reported, or a
    // catalogue that never refreshes looks like nothing at all.
    refreshGeniusCatalog(supabase, storage())
      .then((leagues) => {
        if (!cancelled) setGenius((prev) => keepIfSame(prev, leagues));
      })
      .catch((err) => {
        console.error("[leagues:genius]", err);
        Sentry.captureException(err);
      });

    refreshProfixioCatalog(supabase, storage())
      .then((leagues) => {
        if (!cancelled) setProfixio((prev) => keepIfSame(prev, leagues));
      })
      .catch((err) => {
        console.error("[leagues:profixio]", err);
        Sentry.captureException(err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Stable identity matters: the picker's selection effect keys on this list
  // (a revalidation that brought the same catalogue keeps the old arrays).
  return useMemo(() => [...genius, ...profixio], [genius, profixio]);
}
