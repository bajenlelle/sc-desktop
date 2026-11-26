/**
 * The league catalogue: the Genius leagues, served by the `genius` edge
 * function, and for the importer the Profixio district leagues too, served by
 * the `profixio` function (docs/profixio.md). Renders immediately from cache
 * or the bundled Genius copy, then revalidates against the functions. The
 * cache keys, validation and fetches live in
 * @scoutable/shared/lib/league-catalog-cache.
 *
 * Why not just bundle it: the `genius` function derives its fetch allowlist
 * from the same structure it serves here, so a season the picker offers is
 * always one the function will fetch; Profixio's list is whatever its API key
 * is granted. A failed fetch keeps whatever we already had: an empty picker
 * would be worse than a stale one.
 *
 * Only the importer asks for Profixio: everything else that reads leagues
 * (Teams pages, stats, reports, game marks) is built on Genius competitions.
 * And it asks only where PROFIXIO_IMPORT is on.
 */
import { useEffect, useMemo, useState } from "react";
import {
  GENIUS_CACHE_KEY,
  PROFIXIO_CACHE_KEY,
  latestCatalog,
  readLeagueCache,
  refreshGeniusCatalog,
  refreshProfixioCatalog,
} from "@scoutable/shared/lib/league-catalog-cache";
import { keepIfSame } from "@scoutable/shared/lib/keep-if-same";
import type { League } from "@scoutable/shared/types/league";
import { BUNDLED_LEAGUES } from "@/lib/basketball-api";
import { createClient } from "@/lib/supabase/client";
import { Sentry } from "@/lib/sentry";

const NONE: League[] = [];

/**
 * Whether the importer offers Profixio's district leagues: off in every build
 * until they are released; `VITE_PROFIXIO_IMPORT=on` in apps/desktop/.env
 * turns it on for a dev build. Games already imported from Profixio open and
 * sync either way.
 */
export const PROFIXIO_IMPORT = import.meta.env.VITE_PROFIXIO_IMPORT === "on";

export function useLeagues({ withProfixio = false }: { withProfixio?: boolean } = {}): League[] {
  const [genius, setGenius] = useState<League[]>(() => latestCatalog(GENIUS_CACHE_KEY) ?? readLeagueCache(localStorage, GENIUS_CACHE_KEY) ?? BUNDLED_LEAGUES);
  const [profixio, setProfixio] = useState<League[]>(() =>
    withProfixio ? (latestCatalog(PROFIXIO_CACHE_KEY) ?? readLeagueCache(localStorage, PROFIXIO_CACHE_KEY) ?? NONE) : NONE,
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // Silent for the user (they keep a working picker) but reported, or a
    // catalogue that never refreshes looks like nothing at all.
    refreshGeniusCatalog(supabase, localStorage)
      .then((leagues) => {
        if (!cancelled) setGenius((prev) => keepIfSame(prev, leagues));
      })
      .catch((err) => {
        console.error("[leagues:genius]", err);
        Sentry.captureException(err);
      });

    if (withProfixio) {
      refreshProfixioCatalog(supabase, localStorage)
        .then((leagues) => {
          if (!cancelled) setProfixio((prev) => keepIfSame(prev, leagues));
        })
        .catch((err) => {
          console.error("[leagues:profixio]", err);
          Sentry.captureException(err);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [withProfixio]);

  // Stable identity matters: upload-zone's selection effect keys on this list
  // (a revalidation that brought the same catalogue keeps the old arrays).
  return useMemo(() => (profixio.length > 0 ? [...genius, ...profixio] : genius), [genius, profixio]);
}
